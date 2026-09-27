import {
  createInitialQuery,
  defineSchema,
  sequentialIds,
  type ResolvedSchema,
  type TableQuery,
} from '@pragma/core';
import { describe, expect, it } from 'vitest';
import {
  noRecencySchema,
  render,
  renderNode,
  usersSchema,
  usersSchemaInput,
} from '../testing/fixtures.js';
import { parseDeterministic } from './parser.js';

const NOW = Date.UTC(2024, 5, 15, 12);
const initial = createInitialQuery(usersSchema);

function parse(text: string, state: TableQuery = initial, schema: ResolvedSchema = usersSchema) {
  return parseDeterministic(text, {
    schema,
    state,
    now: NOW,
    timezone: 'UTC',
    ids: sequentialIds(),
  });
}

/** Instructions the parser must fully cover, with the expected mutations. */
const COVERED: readonly [string, string[]][] = [
  // comparisons
  ['age > 25', ['filter age gt 25']],
  ['@age >= 25', ['filter age gte 25']],
  ['age is greater than 25', ['filter age gt 25']],
  ['age over twenty five', ['filter age gt 25']],
  ['age at least 18', ['filter age gte 18']],
  ['age below 30', ['filter age lt 30']],
  ['age no more than 30', ['filter age lte 30']],
  ['age between 25 and 40', ['filter age between [25,40]']],
  ['age from 20 to 30', ['filter age between [20,30]']],
  ['age not between 25 and 40', ['filter age notBetween [25,40]']],
  ['age 25', ['filter age eq 25']],
  ['age is 25 or 30', ['filter (age eq 25 or age eq 30)']],
  ['revenue over 5 lakh', ['filter revenue gt 500000']],
  ['revenue > 25k', ['filter revenue gt 25000']],
  ['revenue above ₹1,00,000', ['filter revenue gt 100000']],
  ['discount above 20%', ['filter discount gt 0.2']],
  // text
  ['name contains Rahul', ['filter name contains "Rahul"']],
  ['email contains rahul@example.com', ['filter email contains "rahul@example.com"']],
  ["name doesn't contain test", ['filter name notContains "test"']],
  ['name starts with "Ra"', ['filter name startsWith "Ra"']],
  ['email ends with example.com', ['filter email endsWith "example.com"']],
  ['country is India', ['filter country eq "India"']],
  ['country is New Zealand', ['filter country eq "New Zealand"']],
  ['country = "United States"', ['filter country eq "United States"']],
  ['country is India or US', ['filter (country eq "India" or country eq "US")']],
  ['country in India, US and UK', ['filter country in ["India","US","UK"]']],
  ['country not in India, US', ['filter country notIn ["India","US"]']],
  ['nation is not India', ['filter country neq "India"']],
  ['country India', ['filter country eq "India"']],
  // null / empty
  ['phone is empty', ['filter phone isEmpty']],
  ['phone is missing', ['filter phone isNull']],
  ['customers with no phone', ['filter phone isNull']],
  ['users without email', ['filter email isNull']],
  ['email has a value', ['filter email isNotNull']],
  // enums & booleans
  ['active users', ['filter status eq "active"']],
  ['status is active', ['filter status eq "active"']],
  ['status disabled', ['filter status eq "inactive"']],
  ['awaiting approval', ['filter status eq "pending"']],
  ['status is active or pending', ['filter (status eq "active" or status eq "pending")']],
  ['not pending', ['filter status neq "pending"']],
  ['status is not active', ['filter status neq "active"']],
  ['verified users', ['filter verified eq true']],
  ['unverified users', ['filter verified eq false']],
  ['not verified', ['filter verified eq false']],
  ['verified is false', ['filter verified eq false']],
  ['plan pro', ['filter plan eq "pro"']],
  // dates
  ['joined today', ['filter createdAt today']],
  ['signup date is yesterday', ['filter createdAt yesterday']],
  ['joined this week', ['filter createdAt thisWeek']],
  ['joined last month', ['filter createdAt lastMonth']],
  ['joined in the last 7 days', ['filter createdAt last {"amount":7,"unit":"day"}']],
  ['joined in the past two weeks', ['filter createdAt last {"amount":2,"unit":"week"}']],
  ['joined in the last day', ['filter createdAt last {"amount":1,"unit":"day"}']],
  ['in the last 24 hours', ['filter createdAt last {"amount":24,"unit":"hour"}']],
  ['this week', ['filter createdAt thisWeek']],
  ['joined before 2024-01-01', ['filter createdAt before "2024-01-01"']],
  ['joined after Jan 10', ['filter createdAt after "2024-01-10"']],
  ['joined since March 1, 2023', ['filter createdAt onOrAfter "2023-03-01"']],
  ['dob before 1990-01-01', ['filter birthDate before "1990-01-01"']],
  ['birthday on 10th May 1994', ['filter birthDate eq "1994-05-10"']],
  ['joined between Jan 1 and Jan 10', ['filter createdAt between ["2024-01-01","2024-01-10"]']],
  // combinations
  [
    'active users with age > 25 and country is India',
    ['filter status eq "active"', 'filter age gt 25', 'filter country eq "India"'],
  ],
  [
    'Show @users where @age > 25, sorted by @createdAt desc',
    ['filter age gt 25', 'sort createdAt desc'],
  ],
  // sorting
  ['sort by age', ['sort age asc']],
  ['sort by age descending', ['sort age desc']],
  ['order by country asc then age desc', ['sort country asc, age desc']],
  ['sort by country, then by age high to low', ['sort country asc, age desc']],
  ['sort newest first', ['sort createdAt desc']],
  ['newest first', ['sort createdAt desc']],
  ['oldest users', ['sort createdAt asc']],
  ['latest birth date', ['sort birthDate desc']],
  ['sort by oldest dob', ['sort birthDate asc']],
  ['sort by name a to z', ['sort name asc']],
  // pagination
  ['20 per page', ['pageSize 20']],
  ['show 50 rows', ['pageSize 50']],
  ['show 100 users', ['pageSize 100']],
  ['50 results per page', ['pageSize 50']],
  ['page size 10', ['pageSize 10']],
  ['limit to 5', ['pageSize 5']],
  ['page 3', ['page 3']],
  ['go to page 2', ['page 2']],
  ['next page', ['nextPage']],
  ['previous page', ['prevPage']],
  ['first page', ['page 1']],
  // search
  ['search Rahul', ['search "Rahul"']],
  ['search for rahul sharma', ['search "rahul sharma"']],
  ['search john in name and email', ['search "john" in name,email']],
  ['"Rahul"', ['search "Rahul"']],
  // commands
  ['clear all filters', ['clearFilters']],
  ['remove filters', ['clearFilters']],
  ['clear search', ['clearSearch']],
  ['clear sorting', ['clearSort']],
  ['unsort', ['clearSort']],
  ['remove the country filter', ['removeFilter country']],
  ['remove filter on age', ['removeFilter age']],
  ['remove age sort', ['removeSort age']],
  ['stop sorting by age', ['removeSort age']],
  ['reset', ['reset']],
  ['reset everything', ['reset']],
  ['start over', ['reset']],
  ['clear filters and only verified', ['clearFilters', 'filter verified eq true']],
  [
    'active users, newest first, 20 per page',
    ['filter status eq "active"', 'pageSize 20', 'sort createdAt desc'],
  ],
];

describe('parseDeterministic: covered phrases', () => {
  it.each(COVERED)('%s', (text, expected) => {
    const result = parse(text);
    expect(result.unconsumed).toEqual([]);
    expect(result.covered).toBe(true);
    expect(render(result.proposal.mutations)).toEqual(expected);
    expect(result.proposal.ambiguities).toEqual([]);
  });
});

/** Instructions the parser must NOT claim (they go to the model or are unsupported). */
const NOT_COVERED: readonly string[] = [
  'show active Indian users older than 25', // "Indian", "older than" need semantics
  'profitable customers',
  'customers who seem inactive recently lol',
  'show me users',
  'filter by salary',
  'age approximately 25',
  'last year',
  'last page',
  'users from India',
  'verified users in India',
  'remove',
  'age',
  'sort by',
  '10/01/2024',
  'top 10 customers by revenue',
  'show all',
];

describe('parseDeterministic: refuses what it does not fully understand', () => {
  it.each(NOT_COVERED)('%s', (text) => {
    const result = parse(text);
    expect(result.covered).toBe(false);
  });

  it('reports unconsumed tokens for diagnostics', () => {
    expect(parse('age > 25 and vibes are good').unconsumed).toEqual(['vibes', 'good']);
  });

  it('never parses hidden fields', () => {
    const result = parse('salary > 100');
    expect(result.covered).toBe(false);
    expect(JSON.stringify(result.proposal)).not.toContain('salary');
  });
});

describe('parseDeterministic: ambiguity', () => {
  it('asks what "recent" means, defaulting to 30 days', () => {
    const result = parse('recent users');
    expect(result.covered).toBe(true);
    const [amb] = result.proposal.ambiguities;
    expect(amb).toMatchObject({ kind: 'date_range', messageKey: 'ambiguity.recent' });
    expect(amb!.options.map((o) => o.label)).toEqual(['Last 7 days', 'Last 30 days', 'This month']);
    expect(amb!.options.find((o) => o.isDefault)?.label).toBe('Last 30 days');
    expect(render(amb!.options[0]!.mutations)).toEqual([
      'filter createdAt last {"amount":7,"unit":"day"}',
    ]);
  });

  it('asks which date "newest" means when there is no recency field', () => {
    const result = parse('newest first', initial, noRecencySchema);
    const [amb] = result.proposal.ambiguities;
    expect(amb?.kind).toBe('field');
    expect(amb!.options.map((o) => o.label)).toEqual(['Birth Date', 'Created At']);
    expect(render(amb!.options[1]!.mutations)).toEqual(['sort createdAt desc']);
  });

  it('asks per date field for "recent" without a recency field', () => {
    const result = parse('recently', initial, noRecencySchema);
    expect(result.proposal.ambiguities[0]!.options).toHaveLength(6);
  });

  it('asks which field a shared enum value belongs to', () => {
    const shared = defineSchema({
      ...usersSchemaInput,
      fields: usersSchemaInput.fields.map((f) =>
        f.id === 'plan' ? { ...f, values: [{ value: 'free' }, { value: 'active' }] } : f,
      ),
    });
    const result = parse('active users', initial, shared);
    expect(result.covered).toBe(true);
    const [amb] = result.proposal.ambiguities;
    expect(amb).toMatchObject({ kind: 'field', messageKey: 'ambiguity.valueField' });
    expect(amb!.options.map((o) => render(o.mutations)[0])).toEqual([
      'filter status eq "active"',
      'filter plan eq "active"',
    ]);
  });
});

describe('parseDeterministic: state-aware refinement', () => {
  const withStatus: TableQuery = {
    ...initial,
    filter: {
      type: 'group',
      id: 'g',
      logic: 'and',
      children: [{ type: 'condition', id: 'c', field: 'status', operator: 'eq', value: 'active' }],
    },
  };
  const withAge: TableQuery = {
    ...initial,
    filter: {
      type: 'group',
      id: 'g',
      logic: 'and',
      children: [{ type: 'condition', id: 'c', field: 'age', operator: 'gt', value: 25 }],
    },
  };

  it('replaces an existing equality filter on the same field', () => {
    expect(render(parse('inactive users', withStatus).proposal.mutations)).toEqual([
      'removeFilter status',
      'filter status eq "inactive"',
    ]);
  });

  it('narrows range filters instead of replacing them', () => {
    expect(render(parse('age < 40', withAge).proposal.mutations)).toEqual(['filter age lt 40']);
  });

  it('removes a currently filtered field by name', () => {
    expect(render(parse('remove age', withAge).proposal.mutations)).toEqual(['removeFilter age']);
  });

  it('does not add a removal when filters are cleared first', () => {
    expect(render(parse('clear filters, pending users', withStatus).proposal.mutations)).toEqual([
      'clearFilters',
      'filter status eq "pending"',
    ]);
  });
});

describe('parseDeterministic: quoted values and compound conditions', () => {
  it.each<[string, string[]]>([
    ['status is "Active"', ['filter status eq "active"']],
    ['age > "1,000"', ['filter age gt 1000']],
    ['joined after "Jan 10"', ['filter createdAt after "2024-01-10"']],
    ['search "john doe"', ['search "john doe"']],
    ['age < 18 or verified users', ['filter (age lt 18 or verified eq true)']],
  ])('%s', (text, expected) => {
    const result = parse(text);
    expect(result.covered).toBe(true);
    expect(render(result.proposal.mutations)).toEqual(expected);
  });

  it('rejects quoted values that do not fit the field', () => {
    expect(parse('age > "lots"').covered).toBe(false);
    expect(parse('joined after "soon"').covered).toBe(false);
    expect(parse('status is "done"').covered).toBe(false);
  });

  it('does not claim recency words on a schema without date fields', () => {
    const noDates = defineSchema({
      schemaVersion: '1',
      resource: 'items',
      fields: [{ id: 'name', label: 'Name', type: 'string' }],
    });
    expect(parse('newest first', createInitialQuery(noDates), noDates).covered).toBe(false);
    expect(parse('recent', createInitialQuery(noDates), noDates).covered).toBe(false);
  });

  it('falls back to UTC for the current year with an unknown timezone', () => {
    const result = parseDeterministic('joined after Jan 10', {
      schema: usersSchema,
      state: initial,
      now: NOW,
      timezone: 'Bad/Zone',
      ids: sequentialIds(),
    });
    expect(render(result.proposal.mutations)).toEqual(['filter createdAt after "2024-01-10"']);
  });
});

describe('parseDeterministic: resource names and value boundaries (regressions)', () => {
  const customers = defineSchema({
    schemaVersion: '1',
    resource: 'customers',
    aliases: ['users'],
    fields: [
      { id: 'name', label: 'Name', type: 'string', aliases: ['customer'] },
      { id: 'country', label: 'Country', type: 'string' },
      { id: 'seats', label: 'Seats', type: 'number', aliases: ['users count'] },
      { id: 'createdAt', label: 'Signed Up', type: 'datetime' },
    ],
    defaults: { recencyField: 'createdAt' },
  });
  const run = (text: string) => parse(text, createInitialQuery(customers), customers);

  it('does not read the table name as a field alias', () => {
    const result = run('customers in India, newest first');
    expect(render(result.proposal.mutations)).not.toContain(
      'filter name in ["India","newest first"]',
    );
    expect(result.covered).toBe(false);
  });

  it('still matches multi-word field terms that start with the table name', () => {
    expect(render(run('users count > 10').proposal.mutations)).toEqual(['filter seats gt 10']);
  });

  it('never swallows a recency phrase or field name as a list value', () => {
    expect(render(run('country in India, US, newest first').proposal.mutations)).toEqual([
      'filter country in ["India","US"]',
      'sort createdAt desc',
    ]);
    expect(render(run('country is India, newest first').proposal.mutations)).toEqual([
      'filter country eq "India"',
      'sort createdAt desc',
    ]);
  });
});

describe('parseDeterministic: robustness', () => {
  it('produces stable ids and valid nodes for OR groups', () => {
    const result = parse('country is India or US');
    const m = result.proposal.mutations[0]!;
    expect(m.op === 'addFilter' && renderNode(m.node)).toBe(
      '(country eq "India" or country eq "US")',
    );
  });

  it('never throws on arbitrary input', () => {
    for (const text of [
      '',
      '   ',
      '!!!',
      '@',
      '@@@',
      '"',
      '""',
      '>>>',
      'age >',
      'between and',
      '1e999',
      '∞',
      'sort by by by',
      'page -1',
      'page 0',
      'x'.repeat(500),
    ]) {
      expect(() => parse(text)).not.toThrow();
    }
  });

  it('does not claim empty or filler-only instructions', () => {
    expect(parse('').covered).toBe(false);
    expect(parse('please show me the users').covered).toBe(false);
  });
});
