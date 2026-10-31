import { useState } from 'react';
import { useApi } from '../../lib/useApi';
import { api, ApiError, qs } from '../../lib/api';
import { useRouter } from '../../lib/router';
import { useMe } from '../../lib/session';
import { formatDate } from '../../lib/format';
import { getIndustry } from '../../../shared/industries';
import { FEEDBACK_STATUSES, type FeedbackDTO, type FeedbackStatus, type FeedbackSummary, type Paged } from '../../../shared/types';
import { Async, Badge, Card, Empty, ErrorBox, Field, Page, Pager } from '../../components/ui';

const LIMIT = 25;
const STATUS_LABEL: Record<FeedbackStatus, string> = { new: 'New', reviewed: 'Reviewed', actioned: 'Action taken', hidden: 'Hidden (abusive / off-topic)' };

export function AdminFeedback() {
  const me = useMe();
  const { search, navigate } = useRouter();
  const topics = getIndustry(me.org.industry).feedbackCategories;
  const status = search.get('status') ?? '';
  const category = search.get('category') ?? '';
  const offset = Number(search.get('offset') ?? 0) || 0;
  const summary = useApi<{ total: number; summaries: FeedbackSummary[] }>('/admin/feedback/summary');
  const list = useApi<Paged<FeedbackDTO>>(`/admin/feedback${qs({ status, category, offset, limit: LIMIT })}`);
  const [error, setError] = useState<ApiError | null>(null);
  const go = (p: Record<string, string | number | undefined>) => navigate(`/admin/feedback${qs({ status, category, ...p })}`);

  async function moderate(f: FeedbackDTO, next: FeedbackStatus) {
    try {
      setError(null);
      await api(`/admin/feedback/${f.id}`, { method: 'PATCH', body: { status: next } });
      list.reload();
      summary.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'ERROR', 'Could not update.'));
    }
  }

  return (
    <Page title="Worker feedback">
      <p className="muted">Feedback is stored without names or accounts and with the date only. Averages are hidden when fewer than 3 people rated a topic.</p>
      <Card title="Summary (all time, excluding hidden)">
        <Async state={summary}>
          {(s) => (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Topic</th>
                    <th scope="col" className="num">
                      Responses
                    </th>
                    <th scope="col" className="num">
                      Avg rating
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {s.summaries.map((x) => (
                    <tr key={x.category}>
                      <td>{x.label}</td>
                      <td className="num">{x.count}</td>
                      <td className="num">{x.averageRating !== null ? `${x.averageRating} / 5` : <span className="muted">Too few</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Async>
      </Card>
      <div className="filter-form">
        <Field label="Status">
          <select value={status} onChange={(e) => go({ status: e.target.value, offset: undefined })}>
            <option value="">Any</option>
            {FEEDBACK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Topic">
          <select value={category} onChange={(e) => go({ category: e.target.value, offset: undefined })}>
            <option value="">Any</option>
            {topics.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {error ? <ErrorBox error={error} /> : null}
      <Card title="Responses">
        <Async state={list}>
          {(d) =>
            d.items.length === 0 ? (
              <Empty>No feedback matches these filters.</Empty>
            ) : (
              <>
                <ul className="list">
                  {d.items.map((f) => (
                    <li key={f.id}>
                      <div className="row">
                        <span>
                          <strong>{topics.find((c) => c.key === f.category)?.label ?? f.category}</strong>
                          {f.rating !== null ? <span className="muted">, rated {f.rating} of 5</span> : null}
                        </span>
                        <Badge tone={f.status === 'new' ? 'warn' : f.status === 'hidden' ? 'neutral' : 'good'}>{STATUS_LABEL[f.status]}</Badge>
                      </div>
                      {f.comment ? <p className="pre-wrap my-1">{f.comment}</p> : <p className="muted small">No comment.</p>}
                      <div className="row">
                        <span className="muted small">
                          {formatDate(f.submittedOn)}
                          {f.synthetic ? ', synthetic' : ''}
                        </span>
                        <label className="small">
                          <span className="visually-hidden">Moderation status</span>
                          <select value={f.status} onChange={(e) => moderate(f, e.target.value as FeedbackStatus)} className="w-auto">
                            {FEEDBACK_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {STATUS_LABEL[s]}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </li>
                  ))}
                </ul>
                <Pager total={d.total} limit={d.limit} offset={d.offset} onChange={(o) => go({ offset: o || undefined })} />
              </>
            )
          }
        </Async>
      </Card>
    </Page>
  );
}
