// Timezone strategy: every timestamp is stored as a UTC ISO-8601 string.
// Calendar logic (work days, weeks, pay periods) uses the organisation's IANA timezone.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isLocalDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const partsCache = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

function zonedParts(date: Date, timeZone: string) {
  const out: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Calendar date (YYYY-MM-DD) of an instant in the given timezone. */
export function localDate(instant: string | Date, timeZone: string): string {
  const p = zonedParts(new Date(instant), timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Offset of the timezone from UTC at the given instant, in minutes. */
export function tzOffsetMinutes(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

/** UTC instant for a wall-clock time (minutes after local midnight) on a local date. */
export function zonedToUtc(date: string, minutesOfDay: number, timeZone: string): Date {
  if (!isLocalDate(date)) throw new RangeError(`Invalid date: ${date}`);
  const naive = Date.parse(`${date}T00:00:00Z`) + minutesOfDay * 60000;
  let guess = naive - tzOffsetMinutes(new Date(naive), timeZone) * 60000;
  // Second pass corrects for offset changes (DST) between the naive guess and the result.
  guess = naive - tzOffsetMinutes(new Date(guess), timeZone) * 60000;
  return new Date(guess);
}

/** UTC instant at which the given local calendar date begins in the timezone. */
export function startOfLocalDay(date: string, timeZone: string): Date {
  return zonedToUtc(date, 0, timeZone);
}

/** Formats an instant as "YYYY-MM-DDTHH:mm" wall-clock time in the timezone (for datetime-local inputs). */
export function toLocalInputValue(instant: string | Date, timeZone: string): string {
  const p = zonedParts(new Date(instant), timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Parses a "YYYY-MM-DDTHH:mm" wall-clock value in the timezone into a UTC ISO string, or null. */
export function fromLocalInputValue(value: string, timeZone: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m || !isLocalDate(m[1]!)) return null;
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  if (Number(m[2]) > 23 || Number(m[3]) > 59) return null;
  return zonedToUtc(m[1]!, minutes, timeZone).toISOString();
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Half-open UTC range [start, end) covering local dates from..to inclusive. */
export function localRangeToUtc(from: string, to: string, timeZone: string): { start: string; end: string } {
  return {
    start: startOfLocalDay(from, timeZone).toISOString(),
    end: startOfLocalDay(addDays(to, 1), timeZone).toISOString(),
  };
}

/** ISO-8601 week key, e.g. "2026-W43", for a local calendar date. */
export function isoWeekKey(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dayNum = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // Thursday of this week
  const weekYear = d.getUTCFullYear();
  const yearStart = Date.UTC(weekYear, 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${weekYear}-W${String(week).padStart(2, '0')}`;
}

/** Whole minutes elapsed between two instants (floored). */
export function minutesBetween(start: string, end: string): number {
  return Math.floor((Date.parse(end) - Date.parse(start)) / 60000);
}

export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
