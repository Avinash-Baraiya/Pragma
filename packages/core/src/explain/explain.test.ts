import { describe, expect, it } from 'vitest';
import type { FilterCondition, FilterGroup, TableQuery } from '../protocol/types.js';
import { defineSchema } from '../schema/define-schema.js';
import { usersSchema } from '../testing/fixtures.js';
import { describeFilter, explainQuery, formatValue } from './explain.js';

const cond = (id: string, field: string, operator: FilterCondition['operator'], value?: FilterCondition['value']): FilterCondition => ({
  type: 'condition',
  id,
  field,
  operator,
  ...(value === undefined ? {} : { value }),
});

const base: TableQuery = { version: '1.0', resource: 'users', search: null, filter: null, sort: [], pagination: { type: 'page', page: 1, pageSize: 20 } };

describe('explainQuery', () => {
  it('describes each part of a query with stable message keys', () => {
    const filter: FilterGroup = {
      type: 'group',
      id: 'root',
      logic: 'and',
      children: [
        cond('f1', 'status', 'eq', 'active'),
        cond('f2', 'age', 'gt', 25),
        { type: 'group', id: 'g2', logic: 'or', children: [cond('f3', 'country', 'eq', 'India'), cond('f4', 'country', 'eq', 'US')] },
      ],
    };
    const items = explainQuery({ ...base, search: { query: 'rahul' }, filter, sort: [{ field: 'createdAt', direction: 'desc' }] }, usersSchema);
    expect(items.map((i) => i.text)).toEqual([
      'Search "rahul"',
      'Status = Active',
      'Age > 25',
      'Country = "India" or Country = "US"',
      'Sorted by Created At (descending)',
      'Page 1, 20 per page',
    ]);
    expect(items[1]).toMatchObject({ kind: 'filter', nodeId: 'f1', field: 'status', messageKey: 'explain.condition.eq', params: { field: 'Status', value: 'Active' } });
    expect(items[3]).toMatchObject({ nodeId: 'g2', messageKey: 'explain.group' });
    expect(items[4]).toMatchObject({ messageKey: 'explain.sort.desc' });
  });

  it('describes every operator arity', () => {
    const texts = [
      cond('a', 'phone', 'isNull'),
      cond('b', 'age', 'between', [25, 40]),
      cond('c', 'country', 'in', ['India', 'US']),
      cond('d', 'createdAt', 'last', { amount: 7, unit: 'day' }),
      cond('e', 'createdAt', 'last', { amount: 1, unit: 'month' }),
      cond('f', 'createdAt', 'today'),
    ].map((c) => explainQuery({ ...base, filter: { type: 'group', id: 'r', logic: 'and', children: [c] } }, usersSchema)[0]!.text);
    expect(texts).toEqual([
      'Phone has no value',
      'Age between 25 and 40',
      'Country is any of "India", "US"',
      'Created At in the last 7 days',
      'Created At in the last 1 month',
      'Created At is today',
    ]);
  });

  it('treats OR and negated roots as a single item', () => {
    const or: FilterGroup = { type: 'group', id: 'r', logic: 'or', children: [cond('a', 'age', 'lt', 5), cond('b', 'age', 'gt', 60)] };
    const items = explainQuery({ ...base, filter: or }, usersSchema).filter((i) => i.kind === 'filter');
    expect(items).toHaveLength(1);
    expect(items[0]?.text).toBe('Age < 5 or Age > 60');
    const not: FilterGroup = { ...or, logic: 'and', not: true };
    expect(explainQuery({ ...base, filter: not }, usersSchema)[0]?.text).toBe('not (Age < 5 and Age > 60)');
  });

  it('parenthesises nested groups and describes search scopes', () => {
    const nested: FilterGroup = {
      type: 'group',
      id: 'r',
      logic: 'or',
      children: [cond('a', 'verified', 'eq', true), { type: 'group', id: 'g', logic: 'and', children: [cond('b', 'age', 'gt', 1), cond('c', 'age', 'lt', 9)] }],
    };
    expect(describeFilter(nested, usersSchema)).toBe('Verified = yes or (Age > 1 and Age < 9)');
    expect(describeFilter(null, usersSchema)).toBe('');
    expect(explainQuery({ ...base, search: { query: 'x', fields: ['name', 'email'] } }, usersSchema)[0]).toMatchObject({ text: 'Search "x" in Name, Email', messageKey: 'explain.searchIn' });
  });

  it('describes sort and each pagination style', () => {
    const texts = (q: Partial<TableQuery>) => explainQuery({ ...base, ...q }, usersSchema).map((i) => i.text);
    expect(texts({ sort: [{ field: 'age', direction: 'asc' }] })[0]).toBe('Sorted by Age (ascending)');
    expect(texts({ pagination: { type: 'offset', offset: 40, limit: 20 } })).toEqual(['Rows 41–60']);
    expect(texts({ pagination: { type: 'cursor', cursor: null, limit: 50 } })).toEqual(['50 per page']);
  });

  it('falls back to raw ids for unknown fields', () => {
    const q = { ...base, filter: { type: 'group' as const, id: 'r', logic: 'and' as const, children: [cond('a', 'ghost', 'eq', 'x')] }, sort: [{ field: 'ghost', direction: 'asc' as const }] };
    expect(explainQuery(q, usersSchema).map((i) => i.text).slice(0, 2)).toEqual(['ghost = x', 'Sorted by ghost (ascending)']);
  });
});

describe('formatValue', () => {
  const f = (id: string) => usersSchema.fieldsById.get(id);
  it('formats by field metadata', () => {
    expect(formatValue(f('status'), 'inactive')).toBe('Inactive');
    expect(formatValue(f('status'), 'unknown')).toBe('unknown');
    expect(formatValue(f('verified'), false)).toBe('no');
    expect(formatValue(f('revenue'), 500000)).toBe('₹500,000');
    expect(formatValue(f('discount'), 0.2)).toBe('20%');
    expect(formatValue(f('age'), 25)).toBe('25');
    expect(formatValue(f('age'), '25')).toBe('25');
    expect(formatValue(f('birthDate'), '2024-01-01')).toBe('2024-01-01');
    expect(formatValue(undefined, 'x')).toBe('x');
  });

  it('handles whole percentages and invalid currency codes', () => {
    const s = defineSchema({
      schemaVersion: '1',
      resource: 't',
      fields: [
        { id: 'p', label: 'P', type: 'number', format: 'percent' },
        { id: 'c', label: 'C', type: 'number', format: 'currency', currency: 'ZZZ' },
      ],
    });
    expect(formatValue(s.fieldsById.get('p'), 20)).toBe('20%');
    expect(formatValue(s.fieldsById.get('c'), 5)).toMatch(/5/);
  });
});
