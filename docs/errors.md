# Errors and warnings

Runtime problems are **returned**, never thrown: `interpret()`, `resolve()` and `apply()` always produce an `InterpretResult`. Only configuration mistakes throw `PragmaConfigError`, and they do so at construction time.

Every problem is a serializable `PragmaIssue`:

```ts
interface PragmaIssue {
  code: ErrorCode; // stable, see below
  message: string; // English fallback
  messageKey: string; // for your own translations, e.g. "field.unknown"
  params?: Record<string, string | number | boolean | string[]>;
  path?: (string | number)[]; // where in the payload
  field?: string;
  retryable: boolean; // may retrying the same request succeed?
  details?: Record<string, unknown>; // e.g. suggestions, allowed operators
}
```

Issues never contain stack traces, upstream response bodies or secrets. Unknown internal errors become `INTERNAL_ERROR` with a generic message.

## Error codes

Codes are part of the public API: they are never renamed or removed within a major version. New codes may be added, so handle unknown codes gracefully.

| Code                           | Typical cause                                                                  | Result status       | HTTP (server)       |
| ------------------------------ | ------------------------------------------------------------------------------ | ------------------- | ------------------- |
| `SCHEMA_ERROR`                 | invalid schema (thrown at startup, or a bad client schema)                     | —                   | 422                 |
| `CONFIG_ERROR`                 | invalid engine, handler or provider configuration (thrown)                     | —                   | —                   |
| `PARSE_ERROR`                  | empty instruction                                                              | error               | 400                 |
| `UNKNOWN_FIELD`                | unknown **or hidden** field                                                    | unsupported         | 200                 |
| `UNKNOWN_RESOURCE`             | `@orders.total` on a `customers` table                                         | unsupported         | 200 / 404           |
| `INVALID_OPERATOR`             | e.g. `contains` on a number                                                    | unsupported         | 200                 |
| `INVALID_VALUE`                | value can't be coerced to the field type                                       | unsupported         | 200                 |
| `TYPE_MISMATCH`                | reserved for adapters                                                          |                     |                     |
| `AMBIGUOUS_QUERY`              | reserved (ambiguity is normally a clarification result)                        |                     |                     |
| `UNSUPPORTED_OPERATION`        | not expressible (joins, aggregation, non-sortable field, …)                    | unsupported         | 200                 |
| `CAPABILITY_UNSUPPORTED`       | e.g. page jump with cursor pagination                                          | unsupported         | 200                 |
| `TARGET_NOT_FOUND`             | removing a filter or sort that isn't applied; no next cursor                   | unsupported         | 200                 |
| `LIMIT_EXCEEDED`               | instruction length, page size, conditions, nesting, sorts                      | unsupported / error | 200 / 400 / 413     |
| `VALIDATION_ERROR`             | malformed payload or current state                                             | error               | 422                 |
| `UNSUPPORTED_PROTOCOL_VERSION` | payload from another major version                                             | error               | 400                 |
| `MODEL_ERROR`                  | provider failure (network, 5xx, bad request)                                   | error               | 502                 |
| `MODEL_OUTPUT_INVALID`         | the model's answer couldn't be understood or repaired                          | error               | 502                 |
| `MODEL_UNAVAILABLE`            | no model configured and the parser can't handle the instruction                | unsupported         | 200                 |
| `RATE_LIMITED`                 | upstream or endpoint rate limit                                                | error               | 429 + `Retry-After` |
| `TIMEOUT`                      | model deadline exceeded                                                        | error               | 504                 |
| `ABORTED`                      | cancelled by the caller                                                        | error               | 499                 |
| `UNAUTHORIZED`                 | authorization hook denied the request (server) / provider rejected credentials | error               | 401/403 / 502       |
| `TRANSPORT_ERROR`              | browser couldn't reach or understand the Pragma server                         | error               | —                   |
| `INTERNAL_ERROR`               | bug; always has a request id                                                   | error               | 500                 |

## Warnings

Warnings accompany `ok` results and never block them.

| Code                        | Meaning                                                                    |
| --------------------------- | -------------------------------------------------------------------------- |
| `EMPTY_RANGE`               | AND-ed conditions on one field can never overlap (`age > 30 AND age < 20`) |
| `CONFLICTING_EQUALITY`      | one field must equal two different values                                  |
| `EMPTY_INTERSECTION`        | AND-ed `in`/`eq` sets share no value                                       |
| `CONFLICTING_NULL`          | a field must be both missing and have a value                              |
| `BOUNDS_REORDERED`          | a reversed `between` range was swapped                                     |
| `DUPLICATE_REMOVED`         | identical conditions or sorts were de-duplicated                           |
| `CONDITIONS_MERGED`         | OR-ed equality on one field became a single `in`                           |
| `VALUE_CLAMPED`             | page size clamped (bestGuess policy)                                       |
| `ASSUMPTION_APPLIED`        | an ambiguity's default option was applied (bestGuess policy)               |
| `TIMEZONE_DEFAULTED`        | relative dates resolved in UTC because no timezone was configured          |
| `MULTIPLE_TARGETS_AFFECTED` | one removal removed several filters                                        |
| `PAGE_CLAMPED`              | "previous page" on the first page                                          |
| `MODEL_UNAVAILABLE`         | reserved for degraded responses                                            |

Pragma reports impossible queries; it never silently "fixes" them.

## Thrown errors

`PragmaError` (base), `PragmaConfigError`, `PragmaValidationError`, `PragmaModelError` (`status`, `retryAfterMs`), `PragmaTransportError` (`status`) and `PragmaTimeoutError`. Use `isPragmaError(value)`: it works across bundles and realms. `error.toIssue()` gives the serializable form.

## Server responses

`@avinash-baraiya/pragma-server` answers completed interpretations (`ok`, `needs_clarification`, `unsupported`) with **200** and the `InterpretResult`. Every other outcome is an RFC 9457 `application/problem+json` body:

```json
{
  "type": "https://github.com/Avinash-Baraiya/Pragma/blob/main/docs/errors.md#rate-limited",
  "title": "Too Many Requests",
  "status": 429,
  "code": "RATE_LIMITED",
  "detail": "Too many requests.",
  "requestId": "req_1x2y3z"
}
```

`x-request-id` is accepted (if well-formed) and always echoed.
