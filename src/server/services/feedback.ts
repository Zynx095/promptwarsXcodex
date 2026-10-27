// Anonymous workplace feedback. No user reference or exact time is stored with a response.
import { randomUUID } from 'node:crypto';
import { summarizeFeedback } from '../../domain/feedback';
import { DomainError } from '../../domain/errors';
import { getIndustry, isFeedbackCategory } from '../../shared/industries';
import { localDate } from '../../shared/time';
import type { FeedbackCreateInput } from '../../shared/schemas';
import type { FeedbackDTO, FeedbackStatus, FeedbackSummary } from '../../shared/types';
import type { AppContext } from '../context';
import type { OrgRow } from '../repositories/orgs';
import { recordAudit } from '../repositories/audit';
import { notFound } from '../http';

export function submitFeedback(ctx: AppContext, org: OrgRow, input: FeedbackCreateInput, opts: { synthetic?: boolean; on?: string } = {}): void {
  if (!isFeedbackCategory(org.industry, input.category)) {
    throw new DomainError('INVALID_CATEGORY', 'Choose one of the listed topics.');
  }
  ctx.db.run(
    `INSERT INTO feedback (id, org_id, category, rating, comment, submitted_on, is_synthetic)
     VALUES (@id, @orgId, @category, @rating, @comment, @on, @synthetic)`,
    {
      id: randomUUID(),
      orgId: org.id,
      category: input.category,
      rating: input.rating ?? null,
      comment: input.comment ? input.comment : null,
      on: opts.on ?? localDate(ctx.now(), org.timezone),
      synthetic: opts.synthetic ?? false,
    },
  );
}

interface FeedbackRow {
  id: string;
  category: string;
  rating: number | null;
  comment: string | null;
  status: FeedbackStatus;
  submittedOn: string;
  synthetic: number;
}

export function listFeedback(ctx: AppContext, orgId: string, f: { status?: FeedbackStatus; category?: string; limit: number; offset: number }) {
  const where = `org_id = @orgId AND (@status IS NULL OR status = @status) AND (@category IS NULL OR category = @category)`;
  const params = { orgId, status: f.status ?? null, category: f.category ?? null };
  const items: FeedbackDTO[] = ctx.db
    .all<FeedbackRow>(
      `SELECT id, category, rating, comment, status, submitted_on AS submittedOn, is_synthetic AS synthetic
       FROM feedback WHERE ${where} ORDER BY submitted_on DESC, rowid DESC LIMIT @limit OFFSET @offset`,
      { ...params, limit: f.limit, offset: f.offset },
    )
    .map((r) => ({ ...r, synthetic: Boolean(r.synthetic) }));
  const total = ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM feedback WHERE ${where}`, params)!.n;
  return { items, total, limit: f.limit, offset: f.offset };
}

export function setFeedbackStatus(ctx: AppContext, orgId: string, actorId: string, id: string, status: FeedbackStatus): void {
  const before = ctx.db.get<{ status: string }>(`SELECT status FROM feedback WHERE id = @id AND org_id = @orgId`, { id, orgId });
  if (!before) throw notFound('Feedback');
  ctx.db.run(`UPDATE feedback SET status = @status WHERE id = @id AND org_id = @orgId`, { id, orgId, status });
  recordAudit(ctx.db, {
    orgId,
    actorId,
    entityType: 'feedback',
    entityId: id,
    action: 'moderate',
    before: { status: before.status },
    after: { status },
    at: ctx.now().toISOString(),
  });
}

/** Aggregates excluding hidden responses; averages suppressed for small groups. */
export function feedbackSummary(ctx: AppContext, org: OrgRow, since?: string): { total: number; summaries: FeedbackSummary[] } {
  const rows = ctx.db.all<{ category: string; rating: number | null }>(
    `SELECT category, rating FROM feedback WHERE org_id = @orgId AND status <> 'hidden' AND (@since IS NULL OR submitted_on >= @since) LIMIT 20000`,
    { orgId: org.id, since: since ?? null },
  );
  return { total: rows.length, summaries: summarizeFeedback(rows, getIndustry(org.industry).feedbackCategories) };
}
