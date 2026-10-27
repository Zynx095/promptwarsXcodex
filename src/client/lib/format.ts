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
