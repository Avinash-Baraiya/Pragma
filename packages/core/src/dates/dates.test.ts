import { describe, expect, it } from 'vitest';
import type { FilterCondition, TableQuery } from '../protocol/types.js';
import { usersSchema } from '../testing/fixtures.js';
import {
  addMonths,
  dayOfWeek,
  epochDayInZone,
  formatEpochDay,
  isValidTimeZone,
  parseDateTimeOperand,
  parsePlainDate,
  rowEpochDay,
  rowInstant,
  startOfWeek,
  toEpochDay,
} from './calendar.js';
import { compileDateRange, inDateRange, operandInterval, resolveDates, type DateContext } from './intervals.js';

const cond = (field: string, operator: FilterCondition['operator'], value?: FilterCondition['value']): FilterCondition => ({
  type: 'condition',
  id: 'f',
  field,
  operator,
  ...(value === undefined ? {} : { value }),
});

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

describe('calendar', () => {
  it('parses and validates plain dates', () => {
    expect(parsePlainDate('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 });
    expect(parsePlainDate('2023-02-29')).toBeUndefined();
    expect(parsePlainDate('2024-13-01')).toBeUndefined();
    expect(parsePlainDate('24-01-01')).toBeUndefined();
  });

  it('clamps month arithmetic', () => {
    expect(addMonths({ year: 2024, month: 3, day: 31 }, -1)).toEqual({ year: 2024, month: 2, day: 29 });
    expect(addMonths({ year: 2024, month: 1, day: 15 }, -1)).toEqual({ year: 2023, month: 12, day: 15 });
    expect(addMonths({ year: 2024, month: 12, day: 31 }, 2)).toEqual({ year: 2025, month: 2, day: 28 });
  });

  it('computes weekdays and week starts', () => {
    const wed = toEpochDay({ year: 2024, month: 6, day: 12 });
    expect(dayOfWeek(wed)).toBe(3);
    expect(formatEpochDay(startOfWeek(wed, 1))).toBe('2024-06-10');
    expect(formatEpochDay(startOfWeek(wed, 0))).toBe('2024-06-09');
  });

  it('validates timezones', () => {
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false); // cached path
  });

  it('parses datetime operands with precision-sized intervals', () => {
    const day = parseDateTimeOperand('2024-06-10', 'Asia/Kolkata')!;
    expect(iso(day.start)).toBe('2024-06-09T18:30:00.000Z');
    expect(day.end - day.start).toBe(86_400_000);
    const minute = parseDateTimeOperand('2024-06-10T10:30', 'UTC')!;
    expect(minute.end - minute.start).toBe(60_000);
    const second = parseDateTimeOperand('2024-06-10T10:30:15Z', 'UTC')!;
    expect(second.end - second.start).toBe(1000);
    const ms = parseDateTimeOperand('2024-06-10T10:30:15.123+05:30', 'UTC')!;
    expect(iso(ms.start)).toBe('2024-06-10T05:00:15.123Z');
    expect(ms.end - ms.start).toBe(1);
    const local = parseDateTimeOperand('2024-06-10T10:30:15.5', 'Asia/Kolkata')!;
    expect(iso(local.start)).toBe('2024-06-10T05:00:15.500Z');
    expect(parseDateTimeOperand('2024-06-10T25:00', 'UTC')).toBeUndefined();
    expect(parseDateTimeOperand('2024-02-30T10:00Z', 'UTC')).toBeUndefined();
    expect(parseDateTimeOperand('2024-02-30T10:00', 'UTC')).toBeUndefined();
    expect(parseDateTimeOperand('yesterday', 'UTC')).toBeUndefined();
  });

  it('reads row values', () => {
    expect(rowInstant(new Date('2024-01-01T00:00:00Z'), 'UTC')).toBe(Date.UTC(2024, 0, 1));
    expect(rowInstant(new Date('invalid'), 'UTC')).toBeUndefined();
    expect(rowInstant(5, 'UTC')).toBe(5);
    expect(rowInstant(Number.NaN, 'UTC')).toBeUndefined();
    expect(rowInstant('Mon, 01 Jan 2024 00:00:00 GMT', 'UTC')).toBe(Date.UTC(2024, 0, 1));
    expect(rowInstant('garbage', 'UTC')).toBeUndefined();
    expect(rowInstant({}, 'UTC')).toBeUndefined();
    expect(rowEpochDay('2024-06-10T23:59:00Z', 'Asia/Kolkata')).toBe(toEpochDay({ year: 2024, month: 6, day: 10 }));
    expect(rowEpochDay(new Date('2024-06-10T20:00:00Z'), 'Asia/Kolkata')).toBe(toEpochDay({ year: 2024, month: 6, day: 11 }));
    expect(rowEpochDay('nope', 'UTC')).toBeUndefined();
    expect(rowEpochDay(null, 'UTC')).toBeUndefined();
    expect(epochDayInZone(Date.UTC(2024, 5, 10, 20), 'UTC')).toBe(toEpochDay({ year: 2024, month: 6, day: 10 }));
  });
});

describe('compileDateRange', () => {
  // Wednesday 2024-06-12 15:00 in Asia/Kolkata (09:30Z).
  const ctx: DateContext = { now: Date.UTC(2024, 5, 12, 9, 30), timezone: 'Asia/Kolkata' };

  const dt = (op: FilterCondition['operator'], value?: FilterCondition['value']): { start: string | null; end: string | null; negate: boolean } => {
    const r = compileDateRange(cond('createdAt', op, value), 'datetime', ctx)!;
    return { start: iso(r.start), end: iso(r.end), negate: r.negate };
  };
  const d = (op: FilterCondition['operator'], value?: FilterCondition['value']): { start: string | null; end: string | null } => {
    const r = compileDateRange(cond('birthDate', op, value), 'date', ctx)!;
    return { start: r.start === null ? null : formatEpochDay(r.start), end: r.end === null ? null : formatEpochDay(r.end) };
  };

  it('resolves calendar periods in the context timezone', () => {
    expect(dt('today')).toEqual({ start: '2024-06-11T18:30:00.000Z', end: '2024-06-12T18:30:00.000Z', negate: false });
    expect(dt('yesterday').start).toBe('2024-06-10T18:30:00.000Z');
    expect(dt('thisWeek').start).toBe('2024-06-09T18:30:00.000Z'); // Monday 2024-06-10 local
    expect(dt('lastWeek').start).toBe('2024-06-02T18:30:00.000Z');
    expect(dt('thisMonth')).toMatchObject({ start: '2024-05-31T18:30:00.000Z', end: '2024-06-30T18:30:00.000Z' });
    expect(dt('lastMonth')).toMatchObject({ start: '2024-04-30T18:30:00.000Z', end: '2024-05-31T18:30:00.000Z' });
    expect(dt('thisYear')).toMatchObject({ start: '2023-12-31T18:30:00.000Z', end: '2024-12-31T18:30:00.000Z' });
  });

  it('respects weekStartsOn=0', () => {
    const r = compileDateRange(cond('birthDate', 'thisWeek'), 'date', { ...ctx, weekStartsOn: 0 })!;
    expect(formatEpochDay(r.start!)).toBe('2024-06-09');
  });

  it('uses rolling windows for datetime last/next', () => {
    expect(dt('last', { amount: 2, unit: 'hour' })).toMatchObject({ start: '2024-06-12T07:30:00.000Z', end: '2024-06-12T09:30:00.001Z' });
    expect(dt('last', { amount: 30, unit: 'minute' }).start).toBe('2024-06-12T09:00:00.000Z');
    expect(dt('last', { amount: 7, unit: 'day' }).start).toBe('2024-06-05T09:30:00.000Z');
    expect(dt('last', { amount: 1, unit: 'month' }).start).toBe('2024-05-12T09:30:00.000Z');
    expect(dt('last', { amount: 1, unit: 'year' }).start).toBe('2023-06-12T09:30:00.000Z');
    expect(dt('last', { amount: 1, unit: 'week' }).start).toBe('2024-06-05T09:30:00.000Z');
    expect(dt('next', { amount: 1, unit: 'day' })).toMatchObject({ start: '2024-06-12T09:30:00.000Z', end: '2024-06-13T09:30:00.001Z' });
  });

  it('includes today in date-field last/next windows', () => {
    expect(d('last', { amount: 7, unit: 'day' })).toEqual({ start: '2024-06-06', end: '2024-06-13' });
    expect(d('last', { amount: 1, unit: 'week' })).toEqual({ start: '2024-06-06', end: '2024-06-13' });
    expect(d('last', { amount: 1, unit: 'month' })).toEqual({ start: '2024-05-13', end: '2024-06-13' });
    expect(d('last', { amount: 1, unit: 'year' })).toEqual({ start: '2023-06-13', end: '2024-06-13' });
    expect(d('next', { amount: 3, unit: 'day' })).toEqual({ start: '2024-06-12', end: '2024-06-15' });
    expect(d('next', { amount: 1, unit: 'week' })).toEqual({ start: '2024-06-12', end: '2024-06-19' });
    expect(d('next', { amount: 1, unit: 'month' })).toEqual({ start: '2024-06-12', end: '2024-07-12' });
    expect(d('next', { amount: 1, unit: 'year' })).toEqual({ start: '2024-06-12', end: '2025-06-12' });
    expect(d('today')).toEqual({ start: '2024-06-12', end: '2024-06-13' });
  });

  it('rejects sub-day units on date fields and missing durations', () => {
    expect(compileDateRange(cond('birthDate', 'last', { amount: 3, unit: 'hour' }), 'date', ctx)).toBeUndefined();
    expect(compileDateRange(cond('birthDate', 'next', { amount: 3, unit: 'minute' }), 'date', ctx)).toBeUndefined();
    expect(compileDateRange(cond('birthDate', 'last'), 'date', ctx)).toBeUndefined();
  });

  it('maps comparison operators to half-open ranges', () => {
    expect(d('eq', '2024-01-10')).toEqual({ start: '2024-01-10', end: '2024-01-11' });
    expect(d('before', '2024-01-10')).toEqual({ start: null, end: '2024-01-10' });
    expect(d('after', '2024-01-10')).toEqual({ start: '2024-01-11', end: null });
    expect(d('onOrBefore', '2024-01-10')).toEqual({ start: null, end: '2024-01-11' });
    expect(d('onOrAfter', '2024-01-10')).toEqual({ start: '2024-01-10', end: null });
    expect(d('between', ['2024-01-01', '2024-01-10'])).toEqual({ start: '2024-01-01', end: '2024-01-11' });
    expect(compileDateRange(cond('birthDate', 'neq', '2024-01-10'), 'date', ctx)!.negate).toBe(true);
    expect(compileDateRange(cond('birthDate', 'notBetween', ['2024-01-01', '2024-01-02']), 'date', ctx)!.negate).toBe(true);
  });

  it('returns undefined for malformed operands and unrelated operators', () => {
    expect(compileDateRange(cond('birthDate', 'eq', 'soon'), 'date', ctx)).toBeUndefined();
    expect(compileDateRange(cond('birthDate', 'eq', 5), 'date', ctx)).toBeUndefined();
    expect(compileDateRange(cond('birthDate', 'between', ['2024-01-01']), 'date', ctx)).toBeUndefined();
    expect(compileDateRange(cond('birthDate', 'between', ['x', '2024-01-01']), 'date', ctx)).toBeUndefined();
    expect(compileDateRange(cond('birthDate', 'isNull'), 'date', ctx)).toBeUndefined();
    expect(operandInterval('bad', 'datetime', 'UTC')).toBeUndefined();
  });

  it('handles DST: "yesterday" in New York on the spring-forward day spans 23 hours', () => {
    // 2024-03-11 12:00 local; yesterday = 2024-03-10, which had 23 hours.
    const r = compileDateRange(cond('createdAt', 'yesterday'), 'datetime', { now: Date.UTC(2024, 2, 11, 16), timezone: 'America/New_York' })!;
    expect((r.end! - r.start!) / 3_600_000).toBe(23);
    expect(iso(r.start)).toBe('2024-03-10T05:00:00.000Z');
  });

  it('tests values against ranges', () => {
    expect(inDateRange(5, { start: 1, end: 10, negate: false })).toBe(true);
    expect(inDateRange(10, { start: 1, end: 10, negate: false })).toBe(false);
    expect(inDateRange(10, { start: 1, end: 10, negate: true })).toBe(true);
    expect(inDateRange(-99, { start: null, end: 0, negate: false })).toBe(true);
  });
});

describe('resolveDates', () => {
  const ctx: DateContext = { now: Date.UTC(2024, 5, 12, 9, 30), timezone: 'UTC' };
  const query = (conditions: FilterCondition[]): TableQuery => ({
    version: '1.0',
    resource: 'users',
    search: null,
    filter: { type: 'group', id: 'g', logic: 'and', children: conditions },
    sort: [],
    pagination: { type: 'page', page: 1, pageSize: 20 },
  });

  it('rewrites relative and datetime operands into absolute ranges', () => {
    const resolved = resolveDates(
      query([
        cond('createdAt', 'today'),
        cond('birthDate', 'last', { amount: 7, unit: 'day' }),
        cond('birthDate', 'today'),
        cond('birthDate', 'eq', '2024-01-01'),
        cond('createdAt', 'before', '2024-01-01'),
        cond('createdAt', 'onOrAfter', '2024-01-01'),
        cond('createdAt', 'neq', '2024-01-01'),
        cond('createdAt', 'isNull'),
        cond('age', 'gt', 5),
      ]),
      usersSchema,
      ctx,
    );
    const c = resolved.filter!.children as FilterCondition[];
    expect(c[0]).toMatchObject({ operator: 'between', value: ['2024-06-12T00:00:00.000Z', '2024-06-12T23:59:59.999Z'] });
    expect(c[1]).toMatchObject({ operator: 'between', value: ['2024-06-06', '2024-06-12'] });
    expect(c[2]).toMatchObject({ operator: 'eq', value: '2024-06-12' });
    expect(c[3]).toMatchObject({ operator: 'eq', value: '2024-01-01' });
    expect(c[4]).toMatchObject({ operator: 'before', value: '2024-01-01T00:00:00.000Z' });
    expect(c[5]).toMatchObject({ operator: 'onOrAfter', value: '2024-01-01T00:00:00.000Z' });
    expect(c[6]).toMatchObject({ operator: 'notBetween' });
    expect(c[7]).toMatchObject({ operator: 'isNull' });
    expect(c[8]).toMatchObject({ operator: 'gt', value: 5 });
  });

  it('leaves queries without filters or with invalid operands untouched', () => {
    const q = { ...query([]), filter: null };
    expect(resolveDates(q, usersSchema, ctx)).toBe(q);
    const bad = query([cond('createdAt', 'eq', 'garbage')]);
    expect((resolveDates(bad, usersSchema, ctx).filter!.children[0] as FilterCondition).value).toBe('garbage');
    const nested = query([{ type: 'group', id: 'g2', logic: 'or', children: [cond('createdAt', 'today')] }]);
    expect(JSON.stringify(resolveDates(nested, usersSchema, ctx))).toContain('between');
  });
});
