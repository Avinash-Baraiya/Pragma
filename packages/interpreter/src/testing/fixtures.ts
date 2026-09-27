import { defineSchema, type FilterNode, type Mutation, type TableSchema } from '@pragma/core';

/** Shared interpreter test schema. Not part of the public API. */
export const usersSchemaInput: TableSchema = {
  schemaVersion: '1',
  resource: 'users',
  label: 'Users',
  aliases: ['customers', 'people'],
  fields: [
    { id: 'name', label: 'Name', type: 'string' },
    { id: 'email', label: 'Email', type: 'string', format: 'email' },
    { id: 'age', label: 'Age', type: 'number' },
    { id: 'country', label: 'Country', type: 'string', aliases: ['nation'] },
    {
      id: 'status',
      label: 'Status',
      type: 'enum',
      values: [
        { value: 'active', label: 'Active' },
        { value: 'inactive', label: 'Inactive', aliases: ['disabled'] },
        { value: 'pending', label: 'Pending', aliases: ['awaiting approval'] },
      ],
    },
    {
      id: 'plan',
      label: 'Plan',
      type: 'enum',
      values: [{ value: 'free' }, { value: 'pro' }, { value: 'enterprise' }],
    },
    { id: 'verified', label: 'Verified', type: 'boolean' },
    { id: 'revenue', label: 'Revenue', type: 'number', format: 'currency', currency: 'INR' },
    {
      id: 'discount',
      label: 'Discount',
      type: 'number',
      format: 'percent',
      percentScale: 'fraction',
    },
    { id: 'phone', label: 'Phone', type: 'string', format: 'phone', sortable: false },
    { id: 'birthDate', label: 'Birth Date', type: 'date', aliases: ['dob', 'birthday'] },
    {
      id: 'createdAt',
      label: 'Created At',
      type: 'datetime',
      aliases: ['signup date', 'joined', 'registration date'],
    },
    { id: 'salary', label: 'Salary', type: 'number', hidden: true },
  ],
  defaults: { pageSize: 20, recencyField: 'createdAt' },
  capabilities: { pagination: ['page', 'cursor'], maxPageSize: 100 },
};

export const usersSchema = defineSchema(usersSchemaInput);

/** Same schema without a recency field (for ambiguity tests). */
export const noRecencySchema = defineSchema({ ...usersSchemaInput, defaults: { pageSize: 20 } });

/** Compact, id-free rendering of mutations for readable assertions. */
export function render(mutations: readonly Mutation[]): string[] {
  return mutations.map((m) => {
    switch (m.op) {
      case 'addFilter':
        return `filter ${renderNode(m.node)}${m.logic === 'or' ? ' (or)' : ''}`;
      case 'replaceFilter':
        return `replaceFilter ${m.node === null ? 'null' : renderNode(m.node)}`;
      case 'removeFilter':
        return `removeFilter ${'field' in m.target ? m.target.field : `#${m.target.id}`}`;
      case 'setSearch':
        return `search ${JSON.stringify(m.search.query)}${m.search.fields ? ` in ${m.search.fields.join(',')}` : ''}`;
      case 'setSort':
        return `sort ${m.sort.map((s) => `${s.field} ${s.direction}`).join(', ')}`;
      case 'addSort':
        return `addSort ${m.spec.field} ${m.spec.direction}`;
      case 'removeSort':
        return `removeSort ${m.field}`;
      case 'setPage':
        return `page ${m.page}`;
      case 'setPageSize':
        return `pageSize ${m.size}`;
      default:
        return m.op;
    }
  });
}

export function renderNode(node: FilterNode): string {
  if (node.type === 'group') return `(${node.children.map(renderNode).join(` ${node.logic} `)})`;
  const value = node.value === undefined ? '' : ` ${JSON.stringify(node.value)}`;
  return `${node.field} ${node.operator}${value}`;
}
