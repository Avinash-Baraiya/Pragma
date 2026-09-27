/**
 * @pragma/react — React components and hooks for Pragma: an accessible ask bar
 * with local `@` autocomplete, removable query chips, explanations,
 * clarification prompts and feedback. Headless-first; optional styles at
 * `@pragma/react/styles.css`.
 *
 * @packageDocumentation
 */

export { PragmaProvider, usePragma } from './context.js';
export type { PragmaContextValue, PragmaProviderProps, PragmaStatus } from './context.js';
export { AskBar, useMentionAutocomplete } from './AskBar.js';
export type { AskBarProps, MentionAutocompleteState } from './AskBar.js';
export { ClarificationPrompt, Explanation, Feedback, QueryChips } from './components.js';
export type {
  ClarificationPromptProps,
  ExplanationProps,
  FeedbackProps,
  QueryChipsProps,
} from './components.js';
