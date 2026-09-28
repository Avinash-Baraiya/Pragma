# Feature tour

Each image below is captured automatically from the live [playground](./playground) with Playwright, so it always shows the current release.

## Ask in plain language

Type what you want to see. Every part of the instruction becomes a removable chip, and the table updates immediately. This instruction was answered by the deterministic parser in the browser, with no model call.

![An instruction in the ask bar, the resulting chips for status, plan, country, sort and page size, and the filtered table.](/screenshots/results.png)

## Reference columns with @

Type `@` to pick a column. Suggestions show the column type and matching aliases, and they come from the schema locally: no network, no model.

![Typing @re in the ask bar lists Lifetime Revenue, Signed Up and Verified with their types.](/screenshots/autocomplete.png)

## Asks instead of guessing

When a request is ambiguous, Pragma asks. Each option carries ready-made changes, so choosing one applies instantly without another model call.

![A clarification asking what "recent" means, with the options Last 7 days, Last 30 days and This month.](/screenshots/clarification.png)

## Refuses what the schema can't answer

Requests outside the schema are refused with a reason and suggested columns. Nothing is invented, and hidden fields behave exactly like fields that do not exist.

![Feedback explaining there is no profit field, suggesting @revenue instead.](/screenshots/unsupported.png)

## Explains exactly what will run

The explanation is generated from the validated query, never written by a model, so it always matches what runs. The same standard `TableQuery` payload can go to TanStack, your API or your database.

![The "Interpreted as" explanation list and the TableQuery JSON payload.](/screenshots/explanation.png)

## Refresh the images

```bash
pnpm --filter @avinash-baraiya/pragma-website screenshots
```
