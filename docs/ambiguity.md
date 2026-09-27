# Ambiguity

When an instruction could reasonably mean different things _and the difference changes the result_, Pragma asks instead of guessing.

```json
{
  "status": "needs_clarification",
  "ambiguities": [
    {
      "id": "amb_1",
      "kind": "date_range",
      "message": "What does \"recent\" mean?",
      "options": [
        { "id": "opt_1", "label": "Last 7 days", "mutations": [/* … */] },
        { "id": "opt_2", "label": "Last 30 days", "mutations": [/* … */], "isDefault": true },
        { "id": "opt_3", "label": "This month", "mutations": [/* … */] }
      ]
    }
  ],
  "partial": [/* unambiguous parts of the same instruction */]
}
```

Each option carries ready-to-apply mutations. `engine.resolve(result, { amb_1: 'opt_1' })` (or `<ClarificationPrompt />`) applies the choice together with `partial`, locally, with **no second model call**.

## What triggers a clarification

| Situation                                  | Kind         | Example                                                                                       |
| ------------------------------------------ | ------------ | --------------------------------------------------------------------------------------------- |
| A vague time window                        | `date_range` | "recent customers"                                                                            |
| Several date fields and no `recencyField`  | `field`      | "newest first"                                                                                |
| A value that exists in several enum fields | `field`      | "active" when `status` and `plan` both have an `active` value                                 |
| An enum value that doesn't exist           | `value`      | "completed orders" when the enum is `pending/approved/rejected` and no alias maps "completed" |
| A model's own judgement                    | any          | "big spenders" (what threshold?)                                                              |

## Policies

- `ambiguity: 'ask'` (default): return `needs_clarification`.
- `ambiguity: 'bestGuess'`: apply each ambiguity's default option (or its first one) and add an `ASSUMPTION_APPLIED` warning that says what was assumed. An over-limit page size is also clamped (`VALUE_CLAMPED`) instead of rejected.

**Never guessed, whatever the policy:** values that don't exist in the schema. "completed" is only mapped to "approved" if the schema says so (`aliases`); otherwise the user is asked to choose from the real values.

## Not ambiguity

- **Conflicting conditions** ("older than 30 and younger than 20") are applied as written, with an `EMPTY_RANGE` warning. Pragma reports intent; it doesn't rewrite it.
- **Unsupported requests** ("profitable customers" with no profit field) are `unsupported`, with suggestions (e.g. `@revenue`). They are never approximated.
