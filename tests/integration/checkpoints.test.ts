import { describe, expect, it } from 'vitest';
import { setup } from './helpers';
import { generateReceiptForShift } from '../../src/server/services/receipts';
import { generateCheckpointForOrg, getIndependentVerificationBundle, getReceiptInclusionProof } from '../../src/server/services/checkpoints';
import { getOrg } from '../../src/server/repositories/orgs';
import { verifyIndependentBundle } from '../../src/domain/proof';
import type { IndependentVerificationBundle } from '../../src/shared/types';

describe('FairShift Proof — Checkpoints, Merkle Trees & Independent Anchoring', () => {
  it('generates cryptographic checkpoints, Merkle inclusion proofs, and self-contained verification bundles', async () => {
    const { ctx, app, login } = await setup();
    const org = getOrg(ctx.db, 'org_demo_construction')!;

    // In seed data, Ravi has completed shifts with generated receipts
    const raviReceipt = ctx.db.get<{ id: string }>(`SELECT id FROM work_receipts WHERE org_id = @orgId AND worker_id = 'usr_demo_c_ravi' LIMIT 1`, {
      orgId: org.id,
    });
    expect(raviReceipt).toBeDefined();
    const receiptId = raviReceipt!.id;

    const adminSession = await login('9000000100'); // Employer admin
    const workerSession = await login('9000000001'); // Ravi (worker)

    // Check initial verification status before checkpoint generation
    const initialVerify = await workerSession.get(`/api/receipts/${receiptId}/verify`);
    expect(initialVerify.status).toBe(200);
    expect(initialVerify.body.verified).toBe(true);
    expect(initialVerify.body.anchored).toBe(false);
    expect(initialVerify.body.trustStatus).toBe('valid_unanchored');

    // 2. Admin triggers checkpoint generation
    const genRes = await adminSession.post('/api/admin/checkpoints/generate').send({});
    expect(genRes.status).toBe(200);
    expect(genRes.body.generated).toBe(true);
    expect(genRes.body.checkpoint).toBeDefined();
    expect(genRes.body.checkpoint.sequence).toBe(1);
    expect(genRes.body.checkpoint.merkleRoot).toMatch(/^[0-9a-f]{64}$/);
    expect(genRes.body.checkpoint.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(genRes.body.checkpoint.previousCheckpointRoot).toBeNull();

    // 3. Worker re-verifies receipt: now anchored!
    const anchoredVerify = await workerSession.get(`/api/receipts/${receiptId}/verify`);
    expect(anchoredVerify.status).toBe(200);
    expect(anchoredVerify.body.verified).toBe(true);
    expect(anchoredVerify.body.anchored).toBe(true);
    expect(anchoredVerify.body.trustStatus).toBe('valid_and_anchored');

    // 4. Worker exports independent verification bundle
    const bundleRes = await workerSession.get(`/api/receipts/${receiptId}/bundle`);
    expect(bundleRes.status).toBe(200);
    const bundle = bundleRes.body as IndependentVerificationBundle;
    expect(bundle.version).toBe('1.0');
    expect(bundle.receipt.shiftId).toBeDefined();
    expect(bundle.checkpoint.sequence).toBe(1);
    expect(bundle.auditPath).toBeDefined();

    // 5. Submit bundle to offline bundle verification endpoint
    const verifyBundleRes = await adminSession.post('/api/admin/checkpoints/verify-bundle').send(bundle);
    expect(verifyBundleRes.status).toBe(200);
    expect(verifyBundleRes.body.valid).toBe(true);
    expect(verifyBundleRes.body.trustStatus).toBe('valid_and_anchored');

    // 6. Test offline domain verification directly without server context
    const offlineResult = verifyIndependentBundle(bundle, ctx.config.checkpointSigningSecret);
    expect(offlineResult.valid).toBe(true);
    expect(offlineResult.trustStatus).toBe('valid_and_anchored');

    // 7. Verify checkpoint hash chaining on subsequent batches
    // Create another shift and receipt for another worker
    const shift2 = ctx.db.get<{ id: string }>(
      `SELECT id FROM shifts WHERE org_id = @orgId AND worker_id = 'usr_demo_c_helper' AND check_out_at IS NOT NULL LIMIT 1`,
      { orgId: org.id },
    );
    if (shift2) {
      // Force an uncheckpointed new receipt version
      ctx.db.run(
        `INSERT INTO work_receipts (id, org_id, shift_id, worker_id, version, key_id, canonical_digest, status, receipt_json, created_at)
         VALUES ('rcpt_new_batch', @orgId, @shiftId, 'usr_demo_c_helper', 99, 'v1', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'finalized', '{}', @now)`,
        { orgId: org.id, shiftId: shift2.id, now: ctx.now().toISOString() },
      );

      const genRes2 = await adminSession.post('/api/admin/checkpoints/generate').send({});
      expect(genRes2.status).toBe(200);
      expect(genRes2.body.checkpoint.sequence).toBe(2);
      expect(genRes2.body.checkpoint.previousCheckpointRoot).toBe(genRes.body.checkpoint.merkleRoot);
    }
  });

  it('rejects tampered bundle and enforces tenant isolation', async () => {
    const { ctx, app, login } = await setup();
    const adminSession = await login('9000000100'); // Construction admin
    const eduAdminSession = await login('9100000100'); // Education admin

    const constructionReceipt = ctx.db.get<{ id: string }>(`SELECT id FROM work_receipts WHERE org_id = 'org_demo_construction' LIMIT 1`)!;

    // Generate checkpoint in construction org
    await adminSession.post('/api/admin/checkpoints/generate').send({});

    // Fetch construction receipt bundle
    const bundleRes = await adminSession.get(`/api/admin/receipts/${constructionReceipt.id}/bundle`);
    expect(bundleRes.status).toBe(200);
    const bundle = bundleRes.body as IndependentVerificationBundle;

    // Tamper the canonical digest
    const tamperedBundle = {
      ...bundle,
      canonicalDigest: 'deadbeef'.repeat(8),
    };
    const tamperedRes = await adminSession.post('/api/admin/checkpoints/verify-bundle').send(tamperedBundle);
    expect(tamperedRes.status).toBe(200);
    expect(tamperedRes.body.valid).toBe(false);
    expect(tamperedRes.body.trustStatus).toBe('invalid_digest');

    // Tenant isolation: Education admin cannot access Construction receipt bundle
    const crossTenantBundle = await eduAdminSession.get(`/api/admin/receipts/${constructionReceipt.id}/bundle`);
    expect(crossTenantBundle.status).toBe(404);
  });
});
