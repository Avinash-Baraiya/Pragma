import { describe, expect, it } from 'vitest';
import { tokenize } from './lexer.js';
import { parseBoolean, parseDate, parseDuration, parseNumber } from './values.js';

const kinds = (s: string) => tokenize(s).map((t) => `${t.kind}:${t.text}`);

describe('tokenize', () => {
  it('splits words, numbers, symbols, separators and mentions', () => {
    expect(kinds('Show @users where @age >= 25, sorted')).toEqual([
      'word:Show',
      'mention:users',
      'word:where',
      'mention:age',
      'symbol:>=',
      'number:25',
      'sep:,',
      'word:sorted',
    ]);
  });

  it('keeps quoted strings verbatim, including smart quotes', () => {
    expect(kinds('name is "Rahul Sharma" or “Anna Müller”')).toEqual(['word:name', 'word:is', 'string:Rahul Sharma', 'word:or', 'string:Anna Müller']);
    expect(kinds('@"Created At" today')).toEqual(['mention:Created At', 'word:today']);
  });

  it('parses numbers with separators, currency, percent and suffixes', () => {
    const values = (s: string) => tokenize(s).map((t) => t.value ?? t.text);
    expect(values('1,00,000 ₹500 $1,250.50 20% 25k 1.5M 2cr 3l')).toEqual([100000, 500, 1250.5, 20, 25000, 1500000, 20000000, 300000]);
    expect(tokenize('20%')[0]?.percent).toBe(true);
  });

  it('recognises ISO dates and date-times', () => {
    expect(kinds('after 2024-01-10 and before 2024-02-01T10:00:00Z')).toEqual(['word:after', 'date:2024-01-10', 'word:and', 'word:before', 'date:2024-02-01T10:00:00Z']);
  });

  it('keeps emails and contractions as single words; strips trailing punctuation', () => {
    expect(kinds("email doesn't contain rahul@example.com.")).toEqual(['word:email', "word:doesn't", 'word:contain', 'word:rahul@example.com']);
    expect(kinds('India! (please)')).toEqual(['word:India', 'word:please']);
  });

  it('treats unbalanced quotes and email-style @ as text', () => {
    expect(kinds('"open')).toEqual(['word:open']);
    expect(kinds('a @ b')).toEqual(['word:a', 'word:b']);
    expect(kinds('10th 2nd')).toEqual(['word:10th', 'word:2nd']);
  });
});

describe('value parsers', () => {
  it('parses number words and multipliers', () => {
    const n = (s: string, fraction = false) => parseNumber(tokenize(s), 0, { percentAsFraction: fraction });
    expect(n('twenty five')).toEqual({ value: 25, length: 2 });
    expect(n('ninety')).toEqual({ value: 90, length: 1 });
    expect(n('seven')).toEqual({ value: 7, length: 1 });
    expect(n('a hundred')).toEqual({ value: 100, length: 2 });
    expect(n('three hundred and twelve')).toEqual({ value: 312, length: 4 });
    expect(n('5 lakh')).toEqual({ value: 500000, length: 2 });
    expect(n('2.5 million')).toEqual({ value: 2500000, length: 2 });
    expect(n('20 percent', true)).toEqual({ value: 0.2, length: 2 });
    expect(n('20%', true)).toEqual({ value: 0.2, length: 1 });
    expect(n('20%')).toEqual({ value: 20, length: 1 });
    expect(n('lots')).toBeUndefined();
    expect(n('')).toBeUndefined();
  });

  it('parses month-name and ISO dates, rejecting impossible ones', () => {
    const d = (s: string) => parseDate(tokenize(s), 0, 2024);
    expect(d('2024-01-10')).toEqual({ value: '2024-01-10', length: 1 });
    expect(d('Jan 10')).toEqual({ value: '2024-01-10', length: 2 });
    expect(d('January 10 2023')).toEqual({ value: '2023-01-10', length: 3 });
    expect(d('Jan 10, 2023')).toEqual({ value: '2023-01-10', length: 4 });
    expect(d('10th March')).toEqual({ value: '2024-03-10', length: 2 });
    expect(d('10 Mar 2022')).toEqual({ value: '2022-03-10', length: 3 });
    expect(d('Feb 30')).toBeUndefined();
    expect(d('30 Feb')).toBeUndefined();
    expect(d('Feb 30, 2023')).toBeUndefined();
    expect(d('Jan')).toBeUndefined();
    expect(d('10/01/2024')).toBeUndefined();
    expect(d('32 Jan')).toBeUndefined();
  });

  it('parses durations and booleans', () => {
    expect(parseDuration(tokenize('7 days'), 0)).toEqual({ value: { amount: 7, unit: 'day' }, length: 2 });
    expect(parseDuration(tokenize('two weeks'), 0)).toEqual({ value: { amount: 2, unit: 'week' }, length: 2 });
    expect(parseDuration(tokenize('24 hrs'), 0)).toEqual({ value: { amount: 24, unit: 'hour' }, length: 2 });
    expect(parseDuration(tokenize('7 bananas'), 0)).toBeUndefined();
    expect(parseDuration(tokenize('1.5 days'), 0)).toBeUndefined();
    expect(parseBoolean(tokenize('yes'), 0)).toEqual({ value: true, length: 1 });
    expect(parseBoolean(tokenize('False'), 0)).toEqual({ value: false, length: 1 });
    expect(parseBoolean(tokenize('maybe'), 0)).toBeUndefined();
    expect(parseBoolean(tokenize('5'), 0)).toBeUndefined();
  });
});
