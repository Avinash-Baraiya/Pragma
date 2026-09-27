# Operators

Every adapter must implement these semantics exactly. The [conformance suite](testing.md#adapter-conformance) checks them against the reference executor (`executeQuery` in `@pragma/core`).

## By type

| Type           | Operators                                                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| string         | `eq` `neq` `contains` `notContains` `startsWith` `endsWith` `in` `notIn` `isEmpty` `isNotEmpty` `isNull` `isNotNull`                                                                        |
| number         | `eq` `neq` `gt` `gte` `lt` `lte` `between` `notBetween` `in` `notIn` `isNull` `isNotNull`                                                                                                   |
| boolean        | `eq` `isNull` `isNotNull`                                                                                                                                                                   |
| enum           | `eq` `neq` `in` `notIn` `isNull` `isNotNull`                                                                                                                                                |
| date, datetime | `eq` `neq` `before` `after` `onOrBefore` `onOrAfter` `between` `notBetween` `last` `next` `today` `yesterday` `thisWeek` `lastWeek` `thisMonth` `lastMonth` `thisYear` `isNull` `isNotNull` |

## Value shapes

| Shape    | Operators                                                                                                                   | Example                                                                        |
| -------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| none     | `isNull` `isNotNull` `isEmpty` `isNotEmpty` `today` `yesterday` `thisWeek` `lastWeek` `thisMonth` `lastMonth` `thisYear`    | (no `value`)                                                                   |
| single   | `eq` `neq` `gt` `gte` `lt` `lte` `contains` `notContains` `startsWith` `endsWith` `before` `after` `onOrBefore` `onOrAfter` | `25`, `"India"`                                                                |
| range    | `between` `notBetween` (inclusive)                                                                                          | `[25, 40]`                                                                     |
| list     | `in` `notIn` (1–100 values)                                                                                                 | `["India", "US"]`                                                              |
| duration | `last` `next`                                                                                                               | `{ "amount": 7, "unit": "day" }` (units: minute, hour, day, week, month, year) |

## Semantics

**Text.** Comparison is case-insensitive (Unicode NFKC, lower-cased) unless `options.caseSensitive` is `true`.

**Nulls (SQL-style).** `null`/`undefined` never satisfies a value operator, _including negative ones_: `neq`, `notIn`, `notContains` and `notBetween` exclude rows where the value is missing. Use `isNull` to match missing values.

- `isEmpty` matches `null`, `undefined` and `""`.
- `isNull` matches only `null` and `undefined`.

**Enums** compare against the canonical `value`. Values typed by users are mapped through `label` and `aliases` during validation.

**Dates** (`date` fields) compare calendar days. Values are `YYYY-MM-DD`; rows may hold such strings, ISO datetimes (the date part is used) or `Date` objects (converted in the query's timezone).

**Datetimes** compare instants. An operand covers an interval whose width follows how it was written:

- `2024-06-10` is that whole local day in `context.timezone`;
- `2024-06-10T10:30` is that minute;
- `2024-06-10T10:30:15Z` is that second.

Given an operand interval `[start, end)`:

| Operator         | Matches                       |
| ---------------- | ----------------------------- |
| `eq` / `neq`     | inside / outside the interval |
| `before`         | `< start`                     |
| `after`          | `≥ end`                       |
| `onOrBefore`     | `< end`                       |
| `onOrAfter`      | `≥ start`                     |
| `between [A, B]` | `≥ A.start` and `< B.end`     |

**Relative dates** resolve in `context.timezone` (default UTC; a `TIMEZONE_DEFAULTED` warning is added when the engine has no timezone configured). Wall-clock arithmetic makes them DST-safe.

| Operator                             | On `datetime`                                              | On `date`                                                                                 |
| ------------------------------------ | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `today`, `yesterday`                 | the local calendar day                                     | the day                                                                                   |
| `thisWeek`, `lastWeek`               | calendar week; weeks start Monday unless `weekStartsOn: 0` | same                                                                                      |
| `thisMonth`, `lastMonth`, `thisYear` | calendar periods                                           | same                                                                                      |
| `last N units`                       | rolling window ending now: `[now − N, now]`                | N periods ending today, **including today** ("last 7 days" = today and the 6 days before) |
| `next N units`                       | `[now, now + N]`                                           | N periods starting today                                                                  |

`minute` and `hour` are not allowed on `date` fields.

`resolveDates(query, schema, { now, timezone })` rewrites relative operators and datetime operands into timezone-free absolute ranges (UTC ISO instants at millisecond precision; `between` inclusive, `before` strict, `onOrAfter` inclusive). That's convenient for SQL backends. Keep the original query as the source of truth.

## Sorting

- Sorts apply in order and are stable (ties keep input order).
- Strings use a locale-aware, numeric-aware collator (`"item 2" < "item 10"`, accent- and case-insensitive).
- Dates and datetimes sort chronologically; booleans sort `false < true`.
- Missing values sort **last** in both directions unless `nulls: 'first'`.

## Pagination

- `page` is 1-based.
- `offset`/`limit` are row-based.
- `cursor` is opaque and issued by your backend. `nextPage`/`prevPage` use the `pageInfo` (`nextCursor`, `prevCursor`) you pass to `interpret`. Jumping to a numbered page is not possible with cursors (`CAPABILITY_UNSUPPORTED`).
