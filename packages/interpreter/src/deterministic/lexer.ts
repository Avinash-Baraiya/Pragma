/**
 * Tokenizer for natural-language table instructions.
 *
 * Produces a flat token stream with the original text preserved (for values
 * such as names, where casing matters) and a lower-cased form for matching.
 */

export type TokenKind = 'word' | 'number' | 'string' | 'mention' | 'date' | 'symbol' | 'sep';

export interface Token {
  readonly kind: TokenKind;
  /** Original text (quotes and `@` removed for strings/mentions). */
  readonly text: string;
  /** Lower-cased, NFKC-normalized text used for matching. */
  readonly norm: string;
  readonly start: number;
  readonly end: number;
  /** Numeric value for `number` tokens (currency symbols and group separators removed). */
  readonly value?: number;
  /** `number` token written with a trailing `%`. */
  readonly percent?: boolean;
}

const QUOTE_PAIRS: Readonly<Record<string, string>> = { '"': '"', "'": "'", '“': '”', '‘': '’' };
const SYMBOLS = ['>=', '<=', '!=', '==', '≥', '≤', '≠', '>', '<', '=', ':'] as const;
const MENTION = /^@(?:"([^"\n]{1,100})"|([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*))/;
const DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?(?![\w-])/i;
const NUMBER = /^[₹$€£¥]?\s?[+-]?(?:\d{1,3}(?:[,_]\d{2,3})+|\d+)(?:\.\d+)?(?:%)?(?![\p{L}\d])/u;
const NUMBER_WITH_SUFFIX = /^[₹$€£¥]?\s?[+-]?(?:\d+(?:\.\d+)?)(k|m|b|mn|bn|cr|l)(?![\p{L}\d])/iu;
const WORD = /^[\p{L}\p{N}_][\p{L}\p{N}_'’@.+-]*/u;

const SUFFIX_MULTIPLIER: Readonly<Record<string, number>> = {
  k: 1e3,
  m: 1e6,
  mn: 1e6,
  b: 1e9,
  bn: 1e9,
  l: 1e5,
  cr: 1e7,
};

function fold(text: string): string {
  return text.normalize('NFKC').toLowerCase();
}

function parseNumberText(raw: string): { value: number; percent: boolean } | undefined {
  const percent = raw.endsWith('%');
  const cleaned = raw.replace(/[₹$€£¥%\s,_]/g, '');
  const value = Number(cleaned);
  return Number.isFinite(value) ? { value, percent } : undefined;
}

/** Tokenize an instruction. Never throws; unknown characters are skipped. */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const rest = input.slice(i);
    const ch = input[i]!;

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    const close = QUOTE_PAIRS[ch];
    if (close !== undefined) {
      const end = input.indexOf(close, i + 1);
      if (end > i + 1) {
        const text = input.slice(i + 1, end);
        tokens.push({ kind: 'string', text, norm: fold(text), start: i, end: end + 1 });
        i = end + 1;
        continue;
      }
      // Unbalanced or apostrophe-like quote: treat as punctuation.
      i++;
      continue;
    }

    if (ch === '@') {
      const m = MENTION.exec(rest);
      if (m) {
        const text = m[1] ?? m[2] ?? '';
        tokens.push({ kind: 'mention', text, norm: fold(text), start: i, end: i + m[0].length });
        i += m[0].length;
        continue;
      }
    }

    if (ch === ',' || ch === ';') {
      tokens.push({ kind: 'sep', text: ch, norm: ch, start: i, end: i + 1 });
      i++;
      continue;
    }

    const date = DATE.exec(rest);
    if (date) {
      tokens.push({ kind: 'date', text: date[0], norm: fold(date[0]), start: i, end: i + date[0].length });
      i += date[0].length;
      continue;
    }

    const suffixed = NUMBER_WITH_SUFFIX.exec(rest);
    if (suffixed) {
      const base = parseNumberText(suffixed[0].slice(0, -suffixed[1]!.length));
      const multiplier = SUFFIX_MULTIPLIER[suffixed[1]!.toLowerCase()];
      if (base && multiplier !== undefined) {
        tokens.push({
          kind: 'number',
          text: suffixed[0],
          norm: fold(suffixed[0]),
          start: i,
          end: i + suffixed[0].length,
          value: base.value * multiplier,
        });
        i += suffixed[0].length;
        continue;
      }
    }

    const number = NUMBER.exec(rest);
    if (number) {
      const parsed = parseNumberText(number[0]);
      if (parsed) {
        tokens.push({
          kind: 'number',
          text: number[0],
          norm: fold(number[0]),
          start: i,
          end: i + number[0].length,
          value: parsed.value,
          ...(parsed.percent ? { percent: true } : {}),
        });
        i += number[0].length;
        continue;
      }
    }

    const symbol = SYMBOLS.find((s) => rest.startsWith(s));
    if (symbol) {
      tokens.push({ kind: 'symbol', text: symbol, norm: symbol, start: i, end: i + symbol.length });
      i += symbol.length;
      continue;
    }

    const word = WORD.exec(rest);
    if (word) {
      // Trailing sentence punctuation is not part of the word ("India." → "India").
      const text = word[0].replace(/[.'’+-]+$/u, '');
      const length = text.length > 0 ? text.length : word[0].length;
      const value = text.length > 0 ? text : word[0];
      tokens.push({ kind: 'word', text: value, norm: fold(value), start: i, end: i + length });
      i += length;
      continue;
    }

    i++; // punctuation such as ! ? ( )
  }
  return tokens;
}
