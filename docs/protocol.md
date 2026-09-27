# Protocol

`TableQuery` is Pragma's core contract: a library-agnostic description of _what_ a table should show. Version `1.0`.

```ts
interface TableQuery {
  version: '1.0';
  resource: string; // e.g. "customers"
  search: { query: string; fields?: string[] } | null;
  filter: FilterGroup | null; // tree; root is always a group
  sort: { field: string; direction: 'asc' | 'desc'; nulls?: 'first' | 'last' }[];
  pagination:
    | { type: 'page'; page: number; pageSize: number } // page is 1-based
    | { type: 'offset'; offset: number; limit: number }
    | { type: 'cursor'; cursor: string | null; limit: number };
  context?: { timezone: string; weekStartsOn?: 0 | 1 }; // for relative dates
}

type FilterNode = FilterGroup | FilterCondition;
interface FilterGroup {
  type: 'group';
  id: string;
  logic: 'and' | 'or';
  not?: boolean;
  children: FilterNode[];
}
interface FilterCondition {
  type: 'condition';
  id: string;
  field: string;
  operator: Operator;
  value?: FilterValue; // shape depends on the operator
  options?: { caseSensitive?: boolean };
}
```

Example: "active Indian customers older than 25, newest first, 20 per page":

```json
{
  "version": "1.0",
  "resource": "customers",
  "search": null,
  "filter": {
    "type": "group",
    "id": "g_1",
    "logic": "and",
    "children": [
      { "type": "condition", "id": "f_1", "field": "status", "operator": "eq", "value": "active" },
      { "type": "condition", "id": "f_2", "field": "country", "operator": "eq", "value": "India" },
      { "type": "condition", "id": "f_3", "field": "age", "operator": "gt", "value": 25 }
    ]
  },
  "sort": [{ "field": "createdAt", "direction": "desc" }],
  "pagination": { "type": "page", "page": 1, "pageSize": 20 },
  "context": { "timezone": "Asia/Kolkata", "weekStartsOn": 1 }
}
```

- Node `id`s are stable within a query. They let a UI remove one chip, or let an instruction target a specific filter.
- Values: numbers are JSON numbers; enum values use the schema's canonical `value`; dates are `YYYY-MM-DD`; datetimes are ISO-8601 (a plain date on a datetime field means that whole local day). See [operators](operators.md).
- `parseTableQuery(unknown)` validates an untrusted payload structurally. `validateQuery(query, schema)` validates it against a schema. A payload with a different **major** version is rejected with `UNSUPPORTED_PROTOCOL_VERSION`.
- `canonicalizeQuery` / `hashQuery` give an id-free canonical form: logically equal queries hash equally.

## Mutations

Interpreters emit mutations; the engine applies them to the current state, in order:

| Mutation                                            | Effect                                                    |
| --------------------------------------------------- | --------------------------------------------------------- |
| `setSearch` / `clearSearch`                         | Replace or clear global search                            |
| `addFilter { node, logic? }`                        | AND (default) or OR a node into the filter                |
| `removeFilter { target: { id } \| { field } }`      | Remove matching nodes (warns when several)                |
| `replaceFilter { node \| null }`                    | Replace the whole filter                                  |
| `clearFilters`                                      | Remove all filters                                        |
| `setSort` / `addSort` / `removeSort` / `clearSort`  | Sort changes                                              |
| `setPage` / `nextPage` / `prevPage` / `setPageSize` | Pagination (cursor navigation uses `pageInfo`)            |
| `reset`                                             | Schema defaults, keeping the pagination style and context |

Rules:

- Any change to search, filters, sort or page size returns to the first page, unless the same batch navigates explicitly.
- Application is all-or-nothing: if one mutation fails (e.g. `TARGET_NOT_FOUND`), the state is unchanged.

## Results

```ts
type InterpretResult =
  | { status: 'ok'; query; mutations; explanation; warnings; meta }
  | { status: 'needs_clarification'; ambiguities; partial; warnings; meta }
  | { status: 'unsupported'; errors; suggestions; meta }
  | { status: 'error'; errors; meta };
```

- **ok**: `query` is valid for the schema and normalized. `explanation` lists human-readable items; each root filter carries its `nodeId` for chips.
- **needs_clarification**: each ambiguity has options with ready-made mutations. `engine.resolve(result, { [ambiguityId]: optionId })` applies them locally with no further model call.
- **unsupported**: the request cannot be expressed with this schema (unknown field, missing capability, limit, …), with `suggestions`.
- **error**: infrastructure or model failure (timeout, rate limit, upstream error, …). `retryable` says whether retrying may help.

`meta` always includes `requestId`, `parser`, `latencyMs`, `schemaHash`, `engineVersion` and `protocolVersion`. When a model was used it also carries `provider`, `model`, `usage` and `retries`.

## JSON Schema

`tableQuerySchema` and `mutationSchema` (Zod) define the exact shapes. Non-JavaScript backends can validate payloads against the JSON Schema produced by `z.toJSONSchema(tableQuerySchema)`.
