import { TZDate } from '@date-fns/tz';

/**
 * Timezone-free calendar arithmetic plus the few timezone conversions the engine
 * needs. Calendar dates are represented as "epoch days" (days since 1970-01-01),
 * which makes ranges on `date` fields simple integer intervals.
 */

const MS_PER_DAY = 86_400_000;

const PLAIN_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})$/i;

export interface PlainDate {
  readonly year: number;
  readonly month: number; // 1-12
  readonly day: number; // 1-31
}

/** Parse `YYYY-MM-DD`, rejecting impossible dates like 2023-02-30. */
export function parsePlainDate(value: string): PlainDate | undefined {
  const m = PLAIN_DATE.exec(value);
  if (!m) return undefined;
  const date = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  return isValidCalendarDate(date) ? date : undefined;
}

export function isValidCalendarDate({ year, month, day }: PlainDate): boolean {
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function toEpochDay(date: PlainDate): number {
  return Math.floor(Date.UTC(date.year, date.month - 1, date.day) / MS_PER_DAY);
}

export function fromEpochDay(epochDay: number): PlainDate {
  const d = new Date(epochDay * MS_PER_DAY);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function formatPlainDate(date: PlainDate): string {
  return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

export function formatEpochDay(epochDay: number): string {
  return formatPlainDate(fromEpochDay(epochDay));
}

/** Add months, clamping the day (Mar 31 − 1 month → Feb 28/29). */
export function addMonths(date: PlainDate, months: number): PlainDate {
  const total = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

/** 0 = Sunday ... 6 = Saturday. */
export function dayOfWeek(epochDay: number): number {
  // 1970-01-01 was a Thursday (4).
  return (((epochDay + 4) % 7) + 7) % 7;
}

export function startOfWeek(epochDay: number, weekStartsOn: 0 | 1): number {
  const diff = (dayOfWeek(epochDay) - weekStartsOn + 7) % 7;
  return epochDay - diff;
}

/* ------------------------------ timezone bits ------------------------------ */

const tzValidity = new Map<string, boolean>();

/** Whether the runtime recognises an IANA timezone name. */
export function isValidTimeZone(timezone: string): boolean {
  const cached = tzValidity.get(timezone);
  if (cached !== undefined) return cached;
  let valid: boolean;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    valid = true;
  } catch {
    valid = false;
  }
  if (tzValidity.size < 1000) tzValidity.set(timezone, valid);
  return valid;
}

/** Calendar date of an instant, as seen in `timezone`. */
export function epochDayInZone(epochMs: number, timezone: string): number {
  const zoned = new TZDate(epochMs, timezone);
  return toEpochDay({
    year: zoned.getFullYear(),
    month: zoned.getMonth() + 1,
    day: zoned.getDate(),
  });
}

/** Instant of local midnight at the start of `epochDay` in `timezone` (DST-safe). */
export function startOfDayInZone(epochDay: number, timezone: string): number {
  const { year, month, day } = fromEpochDay(epochDay);
  return new TZDate(year, month - 1, day, 0, 0, 0, 0, timezone).getTime();
}

/** Shift an instant by whole calendar units in `timezone` (wall-clock arithmetic across DST). */
export function shiftInZone(
  epochMs: number,
  timezone: string,
  unit: 'day' | 'week' | 'month' | 'year',
  amount: number,
): number {
  const zoned = new TZDate(epochMs, timezone);
  switch (unit) {
    case 'day':
      zoned.setDate(zoned.getDate() + amount);
      break;
    case 'week':
      zoned.setDate(zoned.getDate() + amount * 7);
      break;
    case 'month': {
      const day = zoned.getDate();
      zoned.setDate(1);
      zoned.setMonth(zoned.getMonth() + amount);
      zoned.setDate(Math.min(day, daysInMonth(zoned.getFullYear(), zoned.getMonth() + 1)));
      break;
    }
    case 'year': {
      const day = zoned.getDate();
      zoned.setDate(1);
      zoned.setFullYear(zoned.getFullYear() + amount);
      zoned.setDate(Math.min(day, daysInMonth(zoned.getFullYear(), zoned.getMonth() + 1)));
      break;
    }
  }
  return zoned.getTime();
}

/* ------------------------------ value parsing ------------------------------ */

/**
 * A datetime operand resolved to a half-open interval `[start, end)` in epoch ms.
 * The width reflects the precision written: a plain date covers the whole local
 * day, `10:30` covers the minute, `10:30:15` the second, and so on.
 */
export interface Interval {
  readonly start: number;
  readonly end: number;
}

/** Parse a datetime operand. Plain dates and local times are interpreted in `timezone`. */
export function parseDateTimeOperand(value: string, timezone: string): Interval | undefined {
  const plain = parsePlainDate(value);
  if (plain) {
    const day = toEpochDay(plain);
    return { start: startOfDayInZone(day, timezone), end: startOfDayInZone(day + 1, timezone) };
  }
  const instant = INSTANT.exec(value);
  if (instant) {
    if (
      !isValidCalendarDate({
        year: Number(instant[1]),
        month: Number(instant[2]),
        day: Number(instant[3]),
      })
    )
      return undefined;
    if (!validTime(instant[4], instant[5], instant[6])) return undefined;
    const ms = Date.parse(value.replace(' ', 'T'));
    if (Number.isNaN(ms)) return undefined;
    return { start: ms, end: ms + precisionMs(instant[6], instant[7]) };
  }
  const local = LOCAL_DATE_TIME.exec(value);
  if (local) {
    const date = { year: Number(local[1]), month: Number(local[2]), day: Number(local[3]) };
    if (!isValidCalendarDate(date) || !validTime(local[4], local[5], local[6])) return undefined;
    const fraction = local[7] === undefined ? 0 : Number(local[7].padEnd(3, '0'));
    const ms = new TZDate(
      date.year,
      date.month - 1,
      date.day,
      Number(local[4]),
      Number(local[5]),
      Number(local[6] ?? 0),
      fraction,
      timezone,
    ).getTime();
    return { start: ms, end: ms + precisionMs(local[6], local[7]) };
  }
  return undefined;
}

function validTime(h: string | undefined, m: string | undefined, s: string | undefined): boolean {
  return Number(h) <= 23 && Number(m) <= 59 && (s === undefined || Number(s) <= 59);
}

function precisionMs(seconds: string | undefined, fraction: string | undefined): number {
  if (seconds === undefined) return 60_000;
  if (fraction === undefined) return 1_000;
  return 1;
}

/** Whether a string is a syntactically and calendrically valid datetime operand. */
export function isDateTimeOperand(value: string): boolean {
  return parseDateTimeOperand(value, 'UTC') !== undefined;
}

/**
 * Extract a comparable instant from a row value of a `datetime` field.
 * Accepts Date, epoch-ms numbers and ISO strings (plain/local strings use `timezone`).
 */
export function rowInstant(value: unknown, timezone: string): number | undefined {
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? undefined : t;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const interval = parseDateTimeOperand(value.trim(), timezone);
    if (interval) return interval.start;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

/**
 * Extract the calendar day of a row value of a `date` field.
 * `YYYY-MM-DD` strings (optionally followed by a time) are taken as written;
 * Date objects and epoch numbers are converted in `timezone`.
 */
export function rowEpochDay(value: unknown, timezone: string): number | undefined {
  if (typeof value === 'string') {
    const plain = parsePlainDate(value.trim().slice(0, 10));
    return plain ? toEpochDay(plain) : undefined;
  }
  const instant = rowInstant(value, timezone);
  return instant === undefined ? undefined : epochDayInZone(instant, timezone);
}
