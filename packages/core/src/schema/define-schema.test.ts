import { describe, expect, it } from 'vitest';
import { isPragmaError, type PragmaError } from '../errors/errors.js';
import { usersSchema, usersSchemaInput } from '../testing/fixtures.js';
import { defineSchema, getField, visibleFields } from './define-schema.js';
import { findFieldByTerm, suggestFields } from './lookup.js';
import type { FieldDef, TableSchema } from './types.js';

function schemaWith(fields: FieldDef[], extra: Partial<TableSchema> = {}): TableSchema {
  return { schemaVersion: '1', resource: 'items', fields, ...extra };
}

function expectSchemaError(input: unknown, fragment: string): PragmaError {
  try {
    defineSchema(input as TableSchema);
  } catch (error) {
    expect(isPragmaError(error)).toBe(true);
    const err = error as PragmaError;
    expect(err.code).toBe('SCHEMA_ERROR');
    expect(err.issues.map((i) => i.message).join('\n')).toContain(fragment);
    return err;
  }
  throw new Error('expected defineSchema to throw');
}

describe('defineSchema', () => {
  it('applies defaults', () => {
    const schema = defineSchema(schemaWith([{ id: 'name', label: 'Name', type: 'string' }, { id: 'n', label: 'N', type: 'number' }]));
    const name = getField(schema, 'name')!;
    expect(name.filterable).toBe(true);
    expect(name.sortable).toBe(true);
    expect(name.searchable).toBe(true);
    expect(getField(schema, 'n')!.searchable).toBe(false);
    expect(name.operators).toContain('contains');
    expect(schema.defaults.pageSize).toBe(20);
    expect(schema.capabilities).toEqual({ search: true, pagination: ['page'], maxPageSize: 500, maxSorts: 5 });
    expect(schema.label).toBe('items');
  });

  it('is deeply frozen', () => {
    expect(Object.isFrozen(usersSchema)).toBe(true);
    expect(Object.isFrozen(usersSchema.fields[0])).toBe(true);
  });

  it('produces a stable hash that changes with the schema', () => {
    expect(defineSchema(usersSchemaInput).hash).toBe(usersSchema.hash);
    const changed = defineSchema({ ...usersSchemaInput, label: 'Customers' });
    expect(changed.hash).not.toBe(usersSchema.hash);
    expect(usersSchema.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('excludes hidden fields from lookups', () => {
    expect(getField(usersSchema, 'salary')).toBeUndefined();
    expect(visibleFields(usersSchema).map((f) => f.id)).not.toContain('salary');
    expect(usersSchema.fields.map((f) => f.id)).toContain('salary');
  });

  it('rejects structurally invalid input', () => {
    expectSchemaError({ schemaVersion: '2', resource: 'x', fields: [] }, 'schemaVersion');
    expectSchemaError(schemaWith([{ id: 'a', label: 'A', type: 'uuid' as never }]), 'type');
    expectSchemaError({ ...schemaWith([{ id: 'a', label: 'A', type: 'string' }]), extra: true }, 'extra');
  });

  it.each<[string, TableSchema, string]>([
    ['bad resource', { ...schemaWith([{ id: 'a', label: 'A', type: 'string' }]), resource: 'my-items' }, 'Resource "my-items"'],
    ['bad field id', schemaWith([{ id: '1abc', label: 'A', type: 'string' }]), 'Field id "1abc"'],
    ['duplicate id', schemaWith([{ id: 'a', label: 'A', type: 'string' }, { id: 'a', label: 'B', type: 'string' }]), 'Duplicate field id'],
    ['alias collision', schemaWith([{ id: 'a', label: 'A', type: 'string', aliases: ['joined'] }, { id: 'b', label: 'Joined', type: 'string' }]), 'used by both'],
    ['id vs label collision', schemaWith([{ id: 'createdAt', label: 'Created', type: 'datetime' }, { id: 'c', label: 'Created At', type: 'string' }]), 'used by both'],
    ['enum without values', schemaWith([{ id: 's', label: 'S', type: 'enum' }]), 'at least one value'],
    ['enum value collision', schemaWith([{ id: 's', label: 'S', type: 'enum', values: [{ value: 'a', aliases: ['done'] }, { value: 'b', label: 'Done' }] }]), 'matches both'],
    ['values on non-enum', schemaWith([{ id: 's', label: 'S', type: 'string', values: [{ value: 'x' }] }]), 'only allowed on enum'],
    ['format type mismatch', schemaWith([{ id: 's', label: 'S', type: 'string', format: 'currency' }]), 'requires type "number"'],
    ['currency without format', schemaWith([{ id: 'n', label: 'N', type: 'number', currency: 'INR' }]), 'requires format "currency"'],
    ['percentScale without format', schemaWith([{ id: 'n', label: 'N', type: 'number', percentScale: 'whole' }]), 'requires format "percent"'],
    ['searchable number', schemaWith([{ id: 'n', label: 'N', type: 'number', searchable: true }]), 'Only string and enum'],
    ['operator not legal for type', schemaWith([{ id: 'n', label: 'N', type: 'number', operators: ['contains'] }]), 'not valid for number'],
    ['empty operator list', schemaWith([{ id: 'n', label: 'N', type: 'number', operators: [] }]), 'empty operator list'],
    ['recencyField missing', schemaWith([{ id: 'a', label: 'A', type: 'string' }], { defaults: { recencyField: 'nope' } }), 'recencyField references unknown'],
    ['recencyField wrong type', schemaWith([{ id: 'a', label: 'A', type: 'string' }], { defaults: { recencyField: 'a' } }), 'must be a date'],
    ['recencyField not sortable', schemaWith([{ id: 'd', label: 'D', type: 'date', sortable: false }], { defaults: { recencyField: 'd' } }), 'must be sortable'],
    ['pageSize above max', schemaWith([{ id: 'a', label: 'A', type: 'string' }], { defaults: { pageSize: 50 }, capabilities: { maxPageSize: 10 } }), 'exceeds capabilities.maxPageSize'],
    ['default sort unknown', schemaWith([{ id: 'a', label: 'A', type: 'string' }], { defaults: { sort: [{ field: 'x', direction: 'asc' }] } }), 'unknown or hidden field "x"'],
    ['default sort not sortable', schemaWith([{ id: 'a', label: 'A', type: 'string', sortable: false }], { defaults: { sort: [{ field: 'a', direction: 'asc' }] } }), 'non-sortable'],
    ['too many default sorts', schemaWith([{ id: 'a', label: 'A', type: 'string' }], { defaults: { sort: [{ field: 'a', direction: 'asc' }, { field: 'a', direction: 'desc' }] }, capabilities: { maxSorts: 1 } }), 'more entries than capabilities.maxSorts'],
    ['duplicate pagination', schemaWith([{ id: 'a', label: 'A', type: 'string' }], { capabilities: { pagination: ['page', 'page'] } }), 'duplicates'],
    ['only hidden fields', schemaWith([{ id: 'a', label: 'A', type: 'string', hidden: true }]), 'at least one visible'],
    ['resource collides with field', { ...schemaWith([{ id: 'items', label: 'Items', type: 'string' }]) }, 'collides'],
  ])('rejects %s', (_name, input, fragment) => {
    expectSchemaError(input, fragment);
  });

  it('reports every issue at once', () => {
    const err = expectSchemaError(
      schemaWith([
        { id: 'a', label: 'A', type: 'enum' },
        { id: 'a', label: 'B', type: 'string', format: 'currency' },
      ]),
      'Duplicate',
    );
    expect(err.issues.length).toBeGreaterThanOrEqual(3);
    expect(err.message).toMatch(/Invalid table schema \(\d+ issues\)/);
  });
});

describe('field lookup', () => {
  it('finds fields by id, label and alias in any style', () => {
    expect(findFieldByTerm(usersSchema, 'createdAt')?.id).toBe('createdAt');
    expect(findFieldByTerm(usersSchema, 'created_at')?.id).toBe('createdAt');
    expect(findFieldByTerm(usersSchema, 'Created At')?.id).toBe('createdAt');
    expect(findFieldByTerm(usersSchema, 'signup date')?.id).toBe('createdAt');
    expect(findFieldByTerm(usersSchema, 'DOB')?.id).toBe('birthDate');
    expect(findFieldByTerm(usersSchema, 'address.city')?.id).toBe('address.city');
    expect(findFieldByTerm(usersSchema, '')).toBeUndefined();
  });

  it('never resolves hidden fields', () => {
    expect(findFieldByTerm(usersSchema, 'salary')).toBeUndefined();
  });

  it('suggests close matches, excluding hidden fields', () => {
    expect(suggestFields(usersSchema, 'emial').map((f) => f.id)).toContain('email');
    expect(suggestFields(usersSchema, 'countr')[0]?.id).toBe('country');
    expect(suggestFields(usersSchema, 'salary').map((f) => f.id)).not.toContain('salary');
    expect(suggestFields(usersSchema, 'zzzzzzzzzz', { limit: 2 })).toHaveLength(2);
    expect(suggestFields(usersSchema, 'x', { predicate: (f) => f.type === 'number' }).every((f) => f.type === 'number')).toBe(true);
  });
});
