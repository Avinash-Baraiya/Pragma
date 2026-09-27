# @avinash-baraiya/pragma-react

Accessible React UI for Pragma, headless-first.

```tsx
import {
  PragmaProvider,
  AskBar,
  QueryChips,
  ClarificationPrompt,
  Feedback,
  Explanation,
} from '@avinash-baraiya/pragma-react';
import '@avinash-baraiya/pragma-react/styles.css'; // optional, themeable, dark-mode aware

<PragmaProvider engine={engine}>
  <AskBar />
  <ClarificationPrompt />
  <Feedback />
  <QueryChips />
  <Explanation />
</PragmaProvider>;
```

The `AskBar` is an ARIA 1.2 combobox with local `@` column autocomplete (no model call). Chip removal and clarification choices are applied locally. `usePragma()` and `useMentionAutocomplete()` support fully custom UIs.

Docs: [integration](../../docs/integration.md)
