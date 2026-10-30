// Display formatting in the organisation's timezone.
import { formatMinutes } from '../../shared/time';

export { formatMinutes };

export function formatDateTime(iso: string, timeZone: string, locale = 'en-IN'): string {
  return new Intl.DateTimeFormat(locale, { timeZone, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

export function formatTime(iso: string, timeZone: string, locale = 'en-IN'): string {
  return new Intl.DateTimeFormat(locale, { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

/** Formats a YYYY-MM-DD calendar date (no timezone shift). */
export function formatDate(date: string, locale = 'en-IN'): string {
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

export function hoursDecimal(minutes: number): string {
  return `${(minutes / 60).toFixed(2).replace(/\.?0+$/, '')} h`;
}

/** Formats a YYYY-MM-DD period compactly ("19–25 Oct"); the year appears only when it differs from the current one or across years. */
export function formatPeriod(from: string, to: string, locale = 'en-IN'): string {
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  const thisYear = new Date().getUTCFullYear();
  const withYear = a.getUTCFullYear() !== b.getUTCFullYear() || a.getUTCFullYear() !== thisYear;
  const fmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' });
  return from === to ? fmt.format(a) : fmt.formatRange(a, b);
}
