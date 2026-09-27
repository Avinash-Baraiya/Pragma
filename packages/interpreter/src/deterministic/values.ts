import type { Token } from './lexer.js';

/** A parsed value and the number of tokens it consumed. */
export interface Parsed<T> {
  readonly value: T;
  readonly length: number;
}

const UNITS: Readonly<Record<string, number>> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};
const TENS: Readonly<Record<string, number>> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const MULTIPLIER_WORDS: Readonly<Record<string, number>> = {
  thousand: 1e3,
  k: 1e3,
  lakh: 1e5,
  lakhs: 1e5,
  lac: 1e5,
  lacs: 1e5,
  million: 1e6,
  mn: 1e6,
  crore: 1e7,
  crores: 1e7,
  cr: 1e7,
  billion: 1e9,
  bn: 1e9,
};

/** Parse "twenty five", "ninety", "a hundred" style numbers up to 999. */
function parseWordNumber(tokens: readonly Token[], pos: number): Parsed<number> | undefined {
  let i = pos;
  let total = 0;
  let matched = false;
  const at = (k: number): string | undefined =>
    tokens[k]?.kind === 'word' ? tokens[k].norm : undefined;

  if ((at(i) === 'a' || at(i) === 'one') && at(i + 1) === 'hundred') {
    total = 100;
    i += 2;
    matched = true;
  } else {
    const u = at(i);
    if (u !== undefined && UNITS[u] !== undefined && at(i + 1) === 'hundred') {
      total = UNITS[u] * 100;
      i += 2;
      matched = true;
    }
  }
  if (matched && at(i) === 'and') i++;

  const tens = at(i);
  if (tens !== undefined && TENS[tens] !== undefined) {
    total += TENS[tens];
    i++;
    matched = true;
    const unit = at(i);
    if (unit !== undefined && UNITS[unit] !== undefined && UNITS[unit] > 0 && UNITS[unit] < 10) {
      total += UNITS[unit];
      i++;
    }
  } else {
    const unit = at(i);
    if (unit !== undefined && UNITS[unit] !== undefined) {
      total += UNITS[unit];
      i++;
      matched = true;
    }
  }
  return matched ? { value: total, length: i - pos } : undefined;
}

export interface NumberParseOptions {
  /** Divide explicit percentages by 100 (field stores fractions). */
  readonly percentAsFraction?: boolean;
}

/**
 * Parse a numeric value: digits (with group separators and currency symbols),
 * number words, multiplier words ("5 lakh", "2.5 million") and percentages.
 */
export function parseNumber(
  tokens: readonly Token[],
  pos: number,
  options: NumberParseOptions = {},
): Parsed<number> | undefined {
  const token = tokens[pos];
  let base: Parsed<number> | undefined;
  let percent = false;
  if (token?.kind === 'number' && token.value !== undefined) {
    base = { value: token.value, length: 1 };
    percent = token.percent === true;
  } else {
    base = parseWordNumber(tokens, pos);
  }
  if (!base) return undefined;

  let value = base.value;
  let length = base.length;
  const next = tokens[pos + length];
  if (next?.kind === 'word') {
    const multiplier = MULTIPLIER_WORDS[next.norm];
    if (multiplier !== undefined) {
      value *= multiplier;
      length++;
    } else if (next.norm === 'percent' || next.norm === 'pct') {
      percent = true;
      length++;
    }
  }
  if (percent && options.percentAsFraction === true)
    value = Math.round((value / 100) * 1e12) / 1e12;
  return { value, length };
}

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function dayNumber(token: Token | undefined): number | undefined {
  if (!token) return undefined;
  const text = token.norm.replace(/(st|nd|rd|th)$/, '');
  if (!/^\d{1,2}$/.test(text)) return undefined;
  const n = Number(text);
  return n >= 1 && n <= 31 ? n : undefined;
}

function yearNumber(token: Token | undefined): number | undefined {
  if (token?.kind !== 'number' || token.value === undefined) return undefined;
  return Number.isInteger(token.value) &&
    token.value >= 1900 &&
    token.value <= 2999 &&
    /^\d{4}$/.test(token.text)
    ? token.value
    : undefined;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function validDate(y: number, m: number, d: number): boolean {
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Parse an absolute date: ISO (`2024-01-10`, with optional time) or month-name
 * forms (`Jan 10`, `January 10, 2024`, `10th Jan 2024`). A missing year uses
 * `currentYear`. Numeric day/month forms such as `10/01/2024` are deliberately
 * not parsed because their order is locale-dependent.
 */
export function parseDate(
  tokens: readonly Token[],
  pos: number,
  currentYear: number,
): Parsed<string> | undefined {
  const token = tokens[pos];
  if (token?.kind === 'date') return { value: token.text, length: 1 };

  // Month Day [,] [Year]
  const month = token?.kind === 'word' ? MONTHS[token.norm] : undefined;
  if (month !== undefined) {
    const day = dayNumber(tokens[pos + 1]);
    if (day !== undefined) {
      let length = 2;
      if (tokens[pos + length]?.kind === 'sep' && tokens[pos + length]?.text === ',') {
        const y = yearNumber(tokens[pos + length + 1]);
        if (y !== undefined) {
          return validDate(y, month, day)
            ? { value: `${y}-${pad(month)}-${pad(day)}`, length: length + 2 }
            : undefined;
        }
      }
      const year = yearNumber(tokens[pos + length]);
      if (year !== undefined) length++;
      const y = year ?? currentYear;
      return validDate(y, month, day)
        ? { value: `${y}-${pad(month)}-${pad(day)}`, length }
        : undefined;
    }
    return undefined;
  }

  // Day Month [Year]
  const day = dayNumber(token);
  const month2 = tokens[pos + 1]?.kind === 'word' ? MONTHS[tokens[pos + 1]!.norm] : undefined;
  if (day !== undefined && month2 !== undefined) {
    const year = yearNumber(tokens[pos + 2]);
    const y = year ?? currentYear;
    return validDate(y, month2, day)
      ? { value: `${y}-${pad(month2)}-${pad(day)}`, length: year === undefined ? 2 : 3 }
      : undefined;
  }
  return undefined;
}

const DURATION_UNIT_WORDS: Readonly<
  Record<string, 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year'>
> = {
  minute: 'minute',
  minutes: 'minute',
  min: 'minute',
  mins: 'minute',
  hour: 'hour',
  hours: 'hour',
  hr: 'hour',
  hrs: 'hour',
  day: 'day',
  days: 'day',
  week: 'week',
  weeks: 'week',
  wk: 'week',
  wks: 'week',
  month: 'month',
  months: 'month',
  year: 'year',
  years: 'year',
  yr: 'year',
  yrs: 'year',
};

/** Parse `7 days`, `two weeks`, `24 hours`. */
export function parseDuration(
  tokens: readonly Token[],
  pos: number,
):
  | Parsed<{ amount: number; unit: 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year' }>
  | undefined {
  const n = parseNumber(tokens, pos);
  if (!n || !Number.isInteger(n.value) || n.value <= 0) return undefined;
  const unitToken = tokens[pos + n.length];
  const unit = unitToken?.kind === 'word' ? DURATION_UNIT_WORDS[unitToken.norm] : undefined;
  if (!unit) return undefined;
  return { value: { amount: n.value, unit }, length: n.length + 1 };
}

/** Parse boolean words. */
export function parseBoolean(tokens: readonly Token[], pos: number): Parsed<boolean> | undefined {
  const t = tokens[pos];
  if (t?.kind !== 'word') return undefined;
  if (t.norm === 'true' || t.norm === 'yes') return { value: true, length: 1 };
  if (t.norm === 'false' || t.norm === 'no') return { value: false, length: 1 };
  return undefined;
}
