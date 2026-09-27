# Schema

The schema describes one logical table. It drives autocomplete, the deterministic parser, the model prompt, validation and execution. Only this metadata is ever sent to a model, never rows.

```ts
import { defineSchema } from '@pragma/core';

export const customersSchema = defineSchema({
  schemaVersion: '1',
  resource: 'customers',
  label: 'Customers',
  aliases: ['users', 'accounts'],
  fields: [
    { id: 'name', label: 'Name', type: 'string' },
    { id: 'age', label: 'Age', type: 'number' },
    {
      id: 'status',
      label: 'Status',
      type: 'enum',
      values: [
        { value: 'active', label: 'Active' },
        { value: 'churned', label: 'Churned', aliases: ['cancelled', 'lost'] },
      ],
    },
    {
      id: 'revenue',
      label: 'Lifetime Revenue',
      type: 'number',
      format: 'currency',
      currency: 'INR',
      aliases: ['ltv'],
    },
    { id: 'createdAt', label: 'Signed Up', type: 'datetime', aliases: ['joined', 'signup date'] },
    { id: 'phone', label: 'Phone', type: 'string', sortable: false },
    { id: 'internalNotes', label: 'Internal Notes', type: 'string', hidden: true },
  ],
  defaults: {
    pageSize: 20,
    recencyField: 'createdAt',
    sort: [{ field: 'createdAt', direction: 'desc' }],
  },
  capabilities: { search: true, pagination: ['page', 'cursor'], maxPageSize: 100, maxSorts: 3 },
});
```

`defineSchema` validates everything at startup and throws one `PragmaConfigError` (`SCHEMA_ERROR`) listing **every** problem. It returns a frozen `ResolvedSchema` with defaults applied, lookup indexes and a stable `hash`.

## Fields

| Property                  | Meaning                                                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                      | Stable key used in queries: letters, digits, `_`; dot-separated segments allowed (`address.city`).                                                 |
| `label`                   | Human name, used in explanations and matching.                                                                                                     |
| `type`                    | `string` · `number` · `boolean` · `date` · `datetime` · `enum`                                                                                     |
| `aliases`                 | Other names users may type ("joined", "signup date"). Must be unique across fields.                                                                |
| `description`             | Semantic hint for the model (e.g. "revenue excluding refunds, INR").                                                                               |
| `format`                  | `currency` · `percent` · `duration` · `rating` (numbers), `email` · `url` · `phone` (strings).                                                     |
| `currency`                | ISO 4217 code for `format: 'currency'`.                                                                                                            |
| `percentScale`            | `whole` (20 means 20%, default) or `fraction` (0.2). "20%" is converted accordingly.                                                               |
| `values`                  | Enum values `{ value, label?, aliases? }`; required for enums. Synonyms ("completed" → "approved") belong here. The engine never invents mappings. |
| `operators`               | Narrow the type's operators for this field.                                                                                                        |
| `filterable` / `sortable` | Default `true`.                                                                                                                                    |
| `searchable`              | Included in global search. Default `true` for strings.                                                                                             |
| `hidden`                  | Never sent to a model, never suggested, and rejected with the _same_ error as a non-existent field.                                                |

## Defaults and capabilities

| Property                   | Default    | Meaning                                                                                                                                         |
| -------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `defaults.pageSize`        | 20         | Page size of the initial query                                                                                                                  |
| `defaults.sort`            | `[]`       | Sort applied on reset                                                                                                                           |
| `defaults.recencyField`    | —          | Date field for "newest", "oldest", "recent" and standalone "this week". Without it, Pragma asks which date is meant (unless there is only one). |
| `capabilities.search`      | `true`     | Whether global search is allowed                                                                                                                |
| `capabilities.pagination`  | `['page']` | Supported styles; the first is the default                                                                                                      |
| `capabilities.maxPageSize` | 500        | Larger requests are `LIMIT_EXCEEDED` (or clamped under `bestGuess`)                                                                             |
| `capabilities.maxSorts`    | 5          | Maximum sort keys                                                                                                                               |

## Rules checked by `defineSchema`

- Duplicate field ids, invalid ids, and names or aliases shared by two fields (after normalizing case and `camelCase`/`snake_case`).
- An enum without values, or enum values whose labels or aliases collide.
- `values` on non-enum fields; a format that doesn't fit the type; `currency` without the currency format; `percentScale` without the percent format.
- Searchable non-text fields; operators that aren't valid for the type; an empty operator list.
- A `recencyField` that is missing, not a date or not sortable; default sorts on unknown or non-sortable fields; a page size above the maximum.
- A schema with no visible fields; a resource name that collides with a field name.

## Deriving a schema from table columns

`@pragma/tanstack` can build a schema from TanStack column definitions that carry `meta.pragma`:

```ts
const columns = [
  { accessorKey: 'age', header: 'Age', meta: { pragma: { type: 'number' } } },
  {
    accessorKey: 'status',
    header: 'Status',
    meta: { pragma: { type: 'enum', values: [{ value: 'active' }] } },
  },
];
const schema = schemaFromColumns(columns, { resource: 'customers' });
```
