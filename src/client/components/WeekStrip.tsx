// A muster-roll row: one column per day with recorded hours, overtime in marigold and the
// scheduled day marked. Figures come from the server's daily breakdown.
import { useI18n } from '../lib/i18n';
import { formatDate, formatMinutes } from '../lib/format';
import type { DaySummary } from '../../shared/types';

function datesBetween(from: string, to: string, limit = 31): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end && out.length < limit) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function shortHours(minutes: number): string {
  return `${(minutes / 60).toFixed(1).replace(/\.0$/, '')}h`;
}

export function WeekStrip({
  from,
  to,
  days,
  scheduledMinutes,
  today,
}: {
  from: string;
  to: string;
  days: DaySummary[];
  scheduledMinutes: number;
  today?: string;
}) {
  const { t, locale } = useI18n();
  const dates = datesBetween(from, to);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const scale = Math.max(scheduledMinutes * 1.25, ...days.map((d) => d.workedMinutes), 60);
  const pct = (m: number) => `${Math.min(100, (m / scale) * 100)}%`;
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });

  return (
    <ol className="weekstrip" aria-label={t('week.label')}>
      {dates.map((date) => {
        const d = byDate.get(date);
        const worked = d?.workedMinutes ?? 0;
        const overtime = d?.overtimeMinutes ?? 0;
        return (
          <li key={date} className={`weekday${date === today ? ' is-today' : ''}${worked ? '' : ' is-empty'}`}>
            <span className="weekday-name" aria-hidden="true">
              {weekday.format(new Date(`${date}T00:00:00Z`))}
            </span>
            <span className="weekday-bar" aria-hidden="true">
              <span className="weekday-fill" style={{ height: pct(worked - overtime) }} />
              <span className="weekday-ot" style={{ height: pct(overtime) }} />
              <span className="weekday-mark" style={{ bottom: pct(scheduledMinutes) }} />
            </span>
            <span className="weekday-hours figure" aria-hidden="true">
              {worked ? shortHours(worked) : '–'}
            </span>
            <span className="visually-hidden">
              {formatDate(date, locale)}:{' '}
              {worked ? t('week.dayWorked', { worked: formatMinutes(worked), overtime: formatMinutes(overtime) }) : t('week.dayNone')}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
