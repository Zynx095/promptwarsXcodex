import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { hashPin } from '../../src/server/auth/crypto';
import { purgeExpiredEvidence } from '../../src/server/services/evidence';
import { GPS_MARKER, jpegWithMetadata, pngWithMetadata } from '../fixtures/images';
import { PHONES, setup, type TestEnv } from './helpers';

const photo = (bytes = jpegWithMetadata(), mime = 'image/jpeg') => ({ mime, data: bytes.toString('base64') });

async function report(agent: Awaited<ReturnType<TestEnv['login']>>, extra: Record<string, unknown> = {}) {
  const res = await agent.post('/api/reports').send({
    category: 'ppe',
    severity: 'high',
    title: 'No helmets at the mixer',
    description: 'Three helpers at the cement mixer have no helmets today.',
    location: 'Tower B, ground floor',
    inspectionChecks: ['helmet'],
    ...extra,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string };
}

/** A second administrator in the construction organisation, for independent verification. */
function addSecondAdmin(env: TestEnv) {
  env.ctx.db.run(
    `INSERT INTO users (id, org_id, role, name, phone, pin_hash, job_title, created_at)
     SELECT 'usr_test_auditor', org_id, 'admin', 'Safety Auditor', '9000000199', @pin, 'Safety auditor', @at FROM users WHERE phone = @adminPhone`,
    { pin: hashPin('1234'), at: env.clock.now.toISOString(), adminPhone: PHONES.constructionAdmin },
  );
}

function visionReturning(labels: { description: string; score: number }[], objects: { name: string; score: number }[] = []) {
  const calls: string[] = [];
  const f = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { requests: { image: { content: string } }[] };
    calls.push(body.requests[0]!.image.content);
    return Response.json({ responses: [{ labelAnnotations: labels, localizedObjectAnnotations: objects }] });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('safety photos', () => {
  it('stores a reporter photo without metadata, sealed and hashed, and serves it only to people who may see the report', async () => {
    const env = await setup();
    const ravi = await env.login(PHONES.ravi);
    const { id } = await report(ravi);
    const up = await ravi.post(`/api/reports/${id}/evidence`).send({ stage: 'hazard', caption: 'Mixer area', ...photo() });
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    expect(up.body).toMatchObject({
      stage: 'hazard',
      mime: 'image/jpeg',
      width: 1200,
      height: 900,
      uploadedBy: 'Reporter',
      analysisStatus: 'not_configured',
      analysis: null,
    });
    expect(up.body.sha256).toMatch(/^[0-9a-f]{64}$/);

    const img = await ravi.get(`/api/reports/${id}/evidence/${up.body.id}/image`).buffer(true);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/jpeg');
    expect(img.headers['cache-control']).toBe('private, no-store');
    expect(img.body.toString('latin1')).not.toContain(GPS_MARKER);

    const verify = await ravi.get(`/api/reports/${id}/evidence/${up.body.id}/verify`);
    expect(verify.body).toMatchObject({ hashMatches: true, sealValid: true, keyId: 'v1' });

    // The organisation's administrator can see it; another worker and another organisation cannot
    const admin = await env.login(PHONES.constructionAdmin);
    expect((await admin.get(`/api/reports/${id}/evidence/${up.body.id}/image`)).status).toBe(200);
    const lakshmi = await env.login(PHONES.lakshmi);
    expect((await lakshmi.get(`/api/reports/${id}/evidence/${up.body.id}/image`)).status).toBe(404);
    const otherOrgAdmin = await env.login(PHONES.campusAdmin);
    expect((await otherOrgAdmin.get(`/api/reports/${id}/evidence/${up.body.id}/image`)).status).toBe(404);
    expect((await otherOrgAdmin.get(`/api/admin/reports/${id}`)).status).toBe(404);
    expect((await otherOrgAdmin.get('/api/admin/inspections')).body.items).toEqual([]);
    expect((await request(env.app).get(`/api/reports/${id}/evidence/${up.body.id}/image`)).status).toBe(401);
  });

  it('keeps a confidential reporter out of the photo record, the listing and the audit trail', async () => {
    const env = await setup();
    const ravi = await env.login(PHONES.ravi);
    const { id } = await report(ravi, { confidential: true });
    const up = await ravi.post(`/api/reports/${id}/evidence`).send({ stage: 'hazard', ...photo() });
    expect(up.status).toBe(201);
    const row = env.ctx.db.get<{ uploader_id: string | null }>(`SELECT uploader_id FROM report_evidence WHERE id = @id`, { id: up.body.id });
    expect(row?.uploader_id).toBeNull();
    const audit = env.ctx.db.all<{ actor_id: string | null }>(`SELECT actor_id FROM audit_events WHERE entity_id = @id`, { id });
    expect(audit.every((a) => a.actor_id === null)).toBe(true);
    const admin = await env.login(PHONES.constructionAdmin);
    const seen = await admin.get(`/api/admin/reports/${id}`);
    expect(seen.body.reporterName).toBeNull();
    expect(seen.body.evidence[0].uploadedBy).toBe('Reporter');
    expect(JSON.stringify(seen.body)).not.toContain('Ravi');
    const listed = await admin.get('/api/admin/inspections');
    expect(JSON.stringify(listed.body)).not.toContain('Ravi');
  });

  it('rejects files that are not photos, mislabelled photos, oversized uploads and a seventh photo', async () => {
    const env = await setup();
    const ravi = await env.login(PHONES.ravi);
    const { id } = await report(ravi);
    const send = (body: object) => ravi.post(`/api/reports/${id}/evidence`).send({ stage: 'hazard', ...body });
    expect((await send({ mime: 'image/jpeg', data: Buffer.from('%PDF-1.7').toString('base64') })).body.error.code).toBe('IMAGE_UNSUPPORTED_TYPE');
    expect((await send(photo(pngWithMetadata(), 'image/jpeg'))).body.error.code).toBe('IMAGE_TYPE_MISMATCH');
    expect((await send({ mime: 'image/gif', data: 'R0lGODlh' })).status).toBe(400);
    expect((await send({ mime: 'image/jpeg', data: 'not base64!!' })).status).toBe(400);
    // Larger than the photo limit after decoding
    const big = Buffer.concat([jpegWithMetadata(), Buffer.alloc(1_510_000)]);
    expect((await send(photo(big))).status).toBe(413);
    // Larger than the request limit: refused before it is read
    expect((await send({ mime: 'image/jpeg', data: 'A'.repeat(2_400_000) })).status).toBe(413);
    for (let i = 0; i < 6; i++) expect((await send(photo())).status).toBe(201);
    expect((await send(photo())).status).toBe(409);
  });

  it('lets only the reporter add hazard photos, and only administrators add photos of the fix', async () => {
    const env = await setup();
    const ravi = await env.login(PHONES.ravi);
    const { id } = await report(ravi);
    const admin = await env.login(PHONES.constructionAdmin);
    expect((await admin.post(`/api/reports/${id}/evidence`).send({ stage: 'hazard', ...photo() })).status).toBe(403);
    expect((await ravi.post(`/api/reports/${id}/evidence`).send({ stage: 'remediation', ...photo() })).status).toBe(403);
    const lakshmi = await env.login(PHONES.lakshmi);
    expect((await lakshmi.post(`/api/reports/${id}/evidence`).send({ stage: 'hazard', ...photo() })).status).toBe(404);
  });

  it('records genuine advisory analysis, and a provider failure as a failure with no findings', async () => {
    const vision = visionReturning([{ description: 'Construction worker', score: 0.94 }], [{ name: 'Person', score: 0.9 }]);
    const env = await setup(undefined, { googleVisionApiKey: 'k' }, vision.f);
    const ravi = await env.login(PHONES.ravi);
    const { id } = await report(ravi);
    const up = await ravi.post(`/api/reports/${id}/evidence`).send({ stage: 'hazard', ...photo() });
    expect(up.body.analysisStatus).toBe('completed');
    expect(up.body.analysis.outcome).toBe('ppe_may_be_missing');
    expect(up.body.analysis.findings.map((f: { kind: string }) => f.kind)).toEqual(['helmet', 'vest', 'footwear']);
    // What was sent is the cleaned photo, without location or owner metadata
    expect(Buffer.from(vision.calls[0]!, 'base64').toString('latin1')).not.toContain(GPS_MARKER);

    const failing = (async () => new Response('err', { status: 500 })) as unknown as typeof fetch;
    const env2 = await setup(undefined, { googleVisionApiKey: 'k' }, failing);
    const ravi2 = await env2.login(PHONES.ravi);
    const r2 = await report(ravi2);
    const up2 = await ravi2.post(`/api/reports/${r2.id}/evidence`).send({ stage: 'hazard', ...photo() });
    expect(up2.status).toBe(201); // the photo is kept
    expect(up2.body).toMatchObject({ analysisStatus: 'failed', analysis: null, reviewStatus: 'pending' });

    // A person reviews the advisory result
    const admin = await env.login(PHONES.constructionAdmin);
    const reviewed = await admin.post(`/api/admin/reports/${id}/evidence/${up.body.id}/review`).send({ decision: 'confirmed', note: 'Seen on site' });
    expect(reviewed.body).toMatchObject({ reviewStatus: 'confirmed', reviewNote: 'Seen on site' });
    const inspections = await admin.get('/api/admin/inspections');
    expect(inspections.body.items[0]).toMatchObject({ hazardPhotos: 1, worstOutcome: 'ppe_may_be_missing', pendingReviews: 0 });
  });

  it('detects a photo altered in the database after it was sealed', async () => {
    const env = await setup();
    const ravi = await env.login(PHONES.ravi);
    const { id } = await report(ravi);
    const up = await ravi.post(`/api/reports/${id}/evidence`).send({ stage: 'hazard', ...photo() });
    // The application cannot change a stored photo
    expect(() => env.ctx.db.run(`UPDATE report_evidence SET bytes = X'00' WHERE id = @id`, { id: up.body.id })).toThrow(/immutable/);
    // Someone with direct database access removes the guard and swaps the bytes
    env.ctx.db.raw.exec('DROP TRIGGER report_evidence_immutable');
    env.ctx.db.run(`UPDATE report_evidence SET bytes = @b WHERE id = @id`, { id: up.body.id, b: jpegWithMetadata(1200, 901) });
    const verify = await ravi.get(`/api/reports/${id}/evidence/${up.body.id}/verify`);
    expect(verify.body).toMatchObject({ hashMatches: false, sealValid: false });
  });
});

describe('two-key closure', () => {
  async function resolvedReport(env: TestEnv) {
    const ravi = await env.login(PHONES.ravi);
    const admin = await env.login(PHONES.constructionAdmin);
    const { id } = await report(ravi);
    await ravi.post(`/api/reports/${id}/evidence`).send({ stage: 'hazard', ...photo() });
    await admin.post(`/api/admin/reports/${id}/transition`).send({ to: 'acknowledged' });
    const noPhoto = await admin.post(`/api/admin/reports/${id}/transition`).send({ to: 'resolved', note: 'Helmets issued' });
    expect(noPhoto.body.error.code).toBe('REMEDIATION_PHOTO_REQUIRED');
    expect((await admin.post(`/api/reports/${id}/evidence`).send({ stage: 'remediation', ...photo() })).status).toBe(201);
    const resolved = await admin.post(`/api/admin/reports/${id}/transition`).send({ to: 'resolved', note: 'Helmets issued to all helpers' });
    expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);
    expect(resolved.body.closure).toMatchObject({ policy: 'two_key', workerResponse: null, remediationPhotos: 1 });
    return { id, ravi, admin };
  }

  it('waits for the reporter, then verifies once they confirm the fix', async () => {
    const env = await setup();
    const { id, ravi, admin } = await resolvedReport(env);
    const early = await admin.post(`/api/admin/reports/${id}/transition`).send({ to: 'outcome_verified', note: 'Checked the mixer area myself' });
    expect(early.body.error.code).toBe('AWAITING_REPORTER');
    const notified = await ravi.get('/api/notifications/mine');
    expect(JSON.stringify(notified.body)).toContain('Check the fix');
    const confirm = await ravi.post(`/api/reports/${id}/response`).send({ decision: 'confirmed' });
    expect(confirm.body.closure.workerResponse).toBe('confirmed');
    expect((await ravi.post(`/api/reports/${id}/response`).send({ decision: 'confirmed' })).status).toBe(409);
    const verified = await admin.post(`/api/admin/reports/${id}/transition`).send({ to: 'outcome_verified', note: 'Checked the mixer area myself' });
    expect(verified.body.status).toBe('outcome_verified');
    expect(verified.body.history.some((h: { note: string }) => h.note.startsWith('Reporter confirmed'))).toBe(true);
  });

  it('reopens the report when the reporter disputes the fix, and requires a reason', async () => {
    const env = await setup();
    const { id, ravi } = await resolvedReport(env);
    expect((await ravi.post(`/api/reports/${id}/response`).send({ decision: 'disputed' })).status).toBe(400);
    const disputed = await ravi.post(`/api/reports/${id}/response`).send({ decision: 'disputed', note: 'Only two helmets for five helpers' });
    expect(disputed.body.status).toBe('reopened');
    expect(disputed.body.closure.workerResponse).toBeNull();
    const lakshmi = await env.login(PHONES.lakshmi);
    expect((await lakshmi.post(`/api/reports/${id}/response`).send({ decision: 'confirmed' })).status).toBe(404);
  });

  it('escalates to an independent administrator when the reporter does not answer in time', async () => {
    const env = await setup();
    addSecondAdmin(env);
    const { id } = await resolvedReport(env);
    env.advance(47 * 60);
    const auditor = await env.login('9000000199');
    expect((await auditor.post(`/api/admin/reports/${id}/transition`).send({ to: 'outcome_verified', note: 'Inspected on site' })).body.error.code).toBe(
      'AWAITING_REPORTER',
    );
    env.advance(2 * 60); // past 48 hours for a high-severity report
    const admin = await env.login(PHONES.constructionAdmin); // sessions last 12 hours
    const self = await admin.post(`/api/admin/reports/${id}/transition`).send({ to: 'outcome_verified', note: 'Inspected on site' });
    expect(self.body.error.code).toBe('SELF_VERIFICATION_DISALLOWED');
    const independent = await auditor
      .post(`/api/admin/reports/${id}/transition`)
      .send({ to: 'outcome_verified', note: 'Inspected on site, helmets on all helpers' });
    expect(independent.body.status).toBe('outcome_verified');
    expect(independent.body.verifiedBy).toContain('escalated: the reporter did not confirm in time');
  });

  it('keeps the existing flow for reports without photos', async () => {
    const env = await setup();
    const ravi = await env.login(PHONES.ravi);
    const admin = await env.login(PHONES.constructionAdmin);
    const { id } = await report(ravi);
    await admin.post(`/api/admin/reports/${id}/transition`).send({ to: 'acknowledged' });
    const resolved = await admin.post(`/api/admin/reports/${id}/transition`).send({ to: 'resolved', note: 'Helmets issued' });
    expect(resolved.body.closure.policy).toBe('standard');
    const verified = await admin.post(`/api/admin/reports/${id}/transition`).send({ to: 'outcome_verified', note: 'Inspected on site' });
    expect(verified.body.status).toBe('outcome_verified');
  });

  it('deletes photos of reports verified more than a year ago', async () => {
    const env = await setup();
    const { id, ravi, admin } = await resolvedReport(env);
    await ravi.post(`/api/reports/${id}/response`).send({ decision: 'confirmed' });
    await admin.post(`/api/admin/reports/${id}/transition`).send({ to: 'outcome_verified', note: 'Inspected on site' });
    expect(purgeExpiredEvidence(env.ctx)).toBe(0);
    env.advance(366 * 24 * 60);
    expect(purgeExpiredEvidence(env.ctx)).toBe(2);
  });
});
