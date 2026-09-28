---
aside: false
---

# Playground

This is the real Pragma engine, validator, React components and TanStack adapter, running in your browser on 500 sample customers.

::: info No server, no API key
GitHub Pages has no server, so this page has **no real language model**. Explicit instructions are handled by the deterministic parser exactly as in production. A small simulated model answers a few sample phrasings (“high value accounts”) so you can see the model path and its validation. In your app, connect [your own model](./ai-models) to handle any phrasing.
:::

<ClientOnly>
  <Playground />
</ClientOnly>

## Things to try

| Type this                                          | What happens                                               |
| -------------------------------------------------- | ---------------------------------------------------------- |
| `@`                                                | Local column autocomplete (no network)                     |
| `status is trial or churned, sort by revenue desc` | Filter + sort, answered locally                            |
| `joined in the last 30 days and not verified`      | Relative dates stay relative in the payload                |
| `revenue between 5 lakh and 20 lakh`               | Indian number formats are understood                       |
| `recent customers`                                 | Pragma asks what “recent” means instead of guessing        |
| `profitable customers`                             | Refused: there is no profit field, and nothing is invented |
| `@internalNotes is empty`                          | Hidden fields behave exactly like fields that do not exist |
| `remove the country filter`                        | Changes apply to the current query                         |

Open **TableQuery payload** under the table to see exactly what your backend would receive.
