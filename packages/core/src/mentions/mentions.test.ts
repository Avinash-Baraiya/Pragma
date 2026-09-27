import { describe, expect, it } from 'vitest';
import { usersSchema } from '../testing/fixtures.js';
import { findMentions, getActiveMention, resolveMention, suggestMentions } from './mentions.js';

describe('findMentions', () => {
  it('finds plain, dotted and quoted mentions with positions', () => {
    const text =
      'Show @users where @age > 25 and @"Created At" is today and @users.country = India';
    expect(findMentions(text).map((m) => [m.text, text.slice(m.start, m.end)])).toEqual([
      ['users', '@users'],
      ['age', '@age'],
      ['Created At', '@"Created At"'],
      ['users.country', '@users.country'],
    ]);
  });

  it('ignores email addresses', () => {
    expect(findMentions('email is rahul@example.com')).toEqual([]);
  });
});

describe('resolveMention', () => {
  it('resolves the resource and its aliases', () => {
    expect(resolveMention(usersSchema, 'users')).toEqual({ kind: 'resource' });
    expect(resolveMention(usersSchema, 'Customers')).toEqual({ kind: 'resource' });
  });

  it('resolves fields by id, label, alias and resource prefix', () => {
    const id = (t: string) => {
      const r = resolveMention(usersSchema, t);
      return r.kind === 'field' ? r.field.id : r.kind;
    };
    expect(id('age')).toBe('age');
    expect(id('Created At')).toBe('createdAt');
    expect(id('joined')).toBe('createdAt');
    expect(id('users.age')).toBe('age');
    expect(id('address.city')).toBe('address.city');
    expect(id('users.nope')).toBe('unknown');
    expect(id('nope')).toBe('unknown');
    expect(id('salary')).toBe('unknown');
  });

  it('reports other resources', () => {
    expect(resolveMention(usersSchema, 'orders.total')).toEqual({
      kind: 'unknownResource',
      resource: 'orders',
    });
  });
});

describe('getActiveMention', () => {
  it('detects the mention under the caret', () => {
    expect(getActiveMention('show @cu', 8)).toEqual({ start: 5, query: 'cu' });
    expect(getActiveMention('show @', 6)).toEqual({ start: 5, query: '' });
    expect(getActiveMention('show @users.ag', 14)).toEqual({ start: 5, query: 'users.ag' });
    expect(getActiveMention('show @"Created A', 16)).toEqual({ start: 5, query: 'Created A' });
  });

  it('returns null outside a mention', () => {
    expect(getActiveMention('show users', 10)).toBeNull();
    expect(getActiveMention('show @age > 5', 13)).toBeNull();
    expect(getActiveMention('a@b', 3)).toBeNull();
    expect(getActiveMention('show @"Created At" x', 20)).toBeNull();
  });
});

describe('suggestMentions', () => {
  const ids = (q: string, limit?: number) =>
    suggestMentions(usersSchema, q, limit === undefined ? {} : { limit }).map((s) => s.id);

  it('lists the resource then fields for an empty query', () => {
    const all = suggestMentions(usersSchema, '', { limit: 50 });
    expect(all[0]).toMatchObject({ kind: 'resource', insertText: '@users' });
    expect(all.map((s) => s.id)).not.toContain('salary');
    expect(all).toHaveLength(13);
  });

  it('ranks exact > prefix > alias/word > substring > subsequence', () => {
    expect(ids('age')[0]).toBe('age');
    expect(ids('co')[0]).toBe('country');
    expect(ids('cr')[0]).toBe('createdAt');
    expect(ids('joined')[0]).toBe('createdAt');
    expect(ids('city')[0]).toBe('address.city');
    expect(ids('date')).toEqual(expect.arrayContaining(['birthDate', 'createdAt']));
    expect(ids('crtd')).toContain('createdAt');
    expect(ids('us')[0]).toBe('users');
    expect(ids('zzz')).toEqual([]);
  });

  it('reports which alias matched', () => {
    expect(suggestMentions(usersSchema, 'sign')[0]).toMatchObject({
      id: 'createdAt',
      matchedAlias: 'signup date',
    });
  });

  it('strips the resource prefix and respects limits and predicates', () => {
    expect(ids('users.ag')).toEqual(['age']);
    expect(ids('', 3)).toHaveLength(3);
    const numeric = suggestMentions(usersSchema, '', {
      predicate: (f) => f.type === 'number',
      limit: 50,
    });
    expect(numeric.filter((s) => s.kind === 'field').every((s) => s.type === 'number')).toBe(true);
  });

  it('is fast enough for every keystroke', () => {
    const start = performance.now();
    for (let i = 0; i < 1000; i++) suggestMentions(usersSchema, 'cre');
    expect((performance.now() - start) / 1000).toBeLessThan(1);
  });
});
