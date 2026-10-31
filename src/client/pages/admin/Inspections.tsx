// Photo inspections: every safety report that came with photos, with the before and after photos
// side by side, the advisory analysis, what still needs a person's review, and where the two-key
// closure stands. Every figure here is counted from stored photos and reports.
import { ChevronRight, ImageOff } from 'lucide-react';
import { useApi } from '../../lib/useApi';
import { Link } from '../../lib/router';
import { useMe } from '../../lib/session';
import { formatDateTime } from '../../lib/format';
import type { InspectionDTO } from '../../../shared/types';
import { Async, Empty, Page, ReportStatusBadge, SeverityBadge } from '../../components/ui';
import { imageUrl, outcomeLabel, outcomeTone } from '../../components/Evidence';

function closureText(i: InspectionDTO): string {
  const c = i.closure;
  if (i.report.status === 'outcome_verified') return 'Closed: outcome verified';
  if (c.policy !== 'two_key') return 'Standard closure';
  if (i.report.status !== 'resolved' && i.report.status !== 'follow_up_pending') {
    return c.remediationPhotos ? 'Fix photo added; not marked resolved yet' : 'Needs a photo of the fix before it can be resolved';
  }
  if (c.workerResponse === 'confirmed') return 'Reporter confirmed the fix: ready to verify';
  if (c.escalationOpen) return 'Reporter did not answer: an independent administrator can verify';
  return 'Waiting for the reporter to confirm the fix';
}

export function AdminInspections() {
  const me = useMe();
  const list = useApi<{ items: InspectionDTO[] }>('/admin/inspections');
  return (
    <Page
      title="Photo inspections"
      description="Safety reports that came with photos. Photo analysis is advisory: a person reviews every result, and nothing here certifies that a place is safe."
    >
      <Async state={list}>
        {(d) =>
          d.items.length === 0 ? (
            <Empty>No report has photos yet. Workers can add photos when they report a hazard.</Empty>
          ) : (
            <ul className="inspection-list">
              {d.items.map((i) => (
                <li key={i.report.id} className="inspection">
                  <div className="inspection-photos">
                    <figure>
                      {i.beforeId ? <img src={imageUrl(i.report.id, i.beforeId)} alt="Hazard as reported" loading="lazy" /> : <Missing />}
                      <figcaption>Before ({i.hazardPhotos})</figcaption>
                    </figure>
                    <figure>
                      {i.afterId ? <img src={imageUrl(i.report.id, i.afterId)} alt="The fix" loading="lazy" /> : <Missing />}
                      <figcaption>After ({i.remediationPhotos})</figcaption>
                    </figure>
                  </div>
                  <div className="inspection-body">
                    <h2 className="inspection-title">
                      <Link to={`/admin/reports/${i.report.id}`}>{i.report.title}</Link>
                    </h2>
                    <p className="inspection-tags">
                      <ReportStatusBadge status={i.report.status} />
                      <SeverityBadge severity={i.report.severity} />
                      {i.worstOutcome ? (
                        <span className={`badge badge-${outcomeTone(i.worstOutcome)}`}>Advisory: {outcomeLabel(i.worstOutcome)}</span>
                      ) : (
                        <span className="badge badge-neutral">Not analysed: manual review</span>
                      )}
                    </p>
                    <p className="inspection-meta">
                      {formatDateTime(i.report.createdAt, me.org.timezone, 'en-IN')}, {i.report.siteName ? `${i.report.siteName}, ` : ''}
                      {i.report.location}
                    </p>
                    <dl className="inspection-facts">
                      <div>
                        <dt>Reviews pending</dt>
                        <dd>{i.analysedPhotos ? `${i.pendingReviews} of ${i.analysedPhotos} analysed` : 'No analysed photos'}</dd>
                      </div>
                      <div>
                        <dt>Closure</dt>
                        <dd>{closureText(i)}</dd>
                      </div>
                    </dl>
                  </div>
                  <Link to={`/admin/reports/${i.report.id}`} className="inspection-open" aria-label={`Open ${i.report.title}`}>
                    <ChevronRight className="icon" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )
        }
      </Async>
    </Page>
  );
}

function Missing() {
  return (
    <span className="inspection-missing">
      <ImageOff className="icon" aria-hidden="true" />
      <span className="visually-hidden">No photo</span>
    </span>
  );
}
