import type { MentionSuggestion } from '@pragma/core';
import { useCallback, useId, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { usePragma } from './context.js';

/** @public */
export interface MentionAutocompleteState {
  /** Whether the suggestion list should be shown. */
  readonly open: boolean;
  readonly suggestions: readonly MentionSuggestion[];
  readonly activeIndex: number;
  readonly setActiveIndex: (index: number) => void;
  /** Insert a suggestion at the active `@mention`. */
  readonly select: (suggestion: MentionSuggestion) => void;
  readonly close: () => void;
  /** Keyboard handling for the input; returns `true` when the event was consumed. */
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => boolean;
  /**
   * Call from the input's change and caret handlers. `typed` is true for text
   * changes: typing reopens a list closed with Escape; caret moves do not.
   */
  readonly update: (text: string, caret: number, typed?: boolean) => void;
}

/**
 * Headless `@` autocomplete. Suggestions are computed locally and synchronously
 * from the schema (no model call), so it can run on every keystroke.
 *
 * @public
 */
export function useMentionAutocomplete(
  inputRef: RefObject<HTMLInputElement | null>,
  value: string,
  onChange: (value: string) => void,
  limit = 8,
): MentionAutocompleteState {
  const { engine } = usePragma();
  const [caret, setCaret] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  const mention = useMemo(() => engine.suggest(value, caret, limit), [engine, value, caret, limit]);
  const open = mention.start !== null && mention.suggestions.length > 0 && dismissedAt !== mention.start;

  const update = useCallback((text: string, position: number, typed = false) => {
    setCaret(position);
    setActiveIndex(0);
    setDismissedAt((d) => (typed || (d !== null && text.lastIndexOf('@', position - 1) !== d) ? null : d));
  }, []);

  const select = useCallback(
    (suggestion: MentionSuggestion) => {
      if (mention.start === null) return;
      const before = value.slice(0, mention.start);
      const after = value.slice(mention.start + 1 + mention.query.length);
      const insert = `${suggestion.insertText} `;
      const next = `${before}${insert}${after.replace(/^\s+/, '')}`;
      const position = before.length + insert.length;
      onChange(next);
      setCaret(position);
      setDismissedAt(null);
      requestAnimationFrame(() => {
        const input = inputRef.current;
        if (input) {
          input.focus();
          input.setSelectionRange(position, position);
        }
      });
    },
    [mention.start, mention.query, value, onChange, inputRef],
  );

  const close = useCallback(() => {
    setDismissedAt(mention.start);
  }, [mention.start]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>): boolean => {
      if (!open || event.nativeEvent.isComposing) return false;
      const count = mention.suggestions.length;
      switch (event.key) {
        case 'ArrowDown':
          setActiveIndex((i) => (i + 1) % count);
          return true;
        case 'ArrowUp':
          setActiveIndex((i) => (i - 1 + count) % count);
          return true;
        case 'Enter':
        case 'Tab': {
          const suggestion = mention.suggestions[activeIndex];
          if (!suggestion) return false;
          select(suggestion);
          return true;
        }
        case 'Escape':
          close();
          return true;
        default:
          return false;
      }
    },
    [open, mention.suggestions, activeIndex, select, close],
  );

  return { open, suggestions: mention.suggestions, activeIndex, setActiveIndex, select, close, onKeyDown, update };
}

/** @public */
export interface AskBarProps {
  readonly placeholder?: string;
  /** Accessible label (visually hidden by default styles). Default "Ask about this table". */
  readonly label?: string;
  readonly submitLabel?: string;
  readonly cancelLabel?: string;
  readonly className?: string;
  readonly autoFocus?: boolean;
  /** Maximum suggestions shown. Default 8. */
  readonly suggestionLimit?: number;
  /** Custom rendering of a suggestion option's content. */
  readonly renderSuggestion?: (suggestion: MentionSuggestion) => ReactNode;
}

/**
 * Natural-language input with local `@field` autocomplete, implemented as an
 * ARIA 1.2 combobox: arrow keys move through suggestions, Enter/Tab select,
 * Escape closes, and Enter submits when the list is closed. IME composition is
 * respected. While interpreting, a cancel button is shown.
 *
 * @public
 */
export function AskBar(props: AskBarProps): ReactNode {
  const { draft, setDraft, submit, cancel, status } = usePragma();
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const listId = `${id}-suggestions`;
  const optionId = (index: number): string => `${id}-option-${index}`;
  const auto = useMentionAutocomplete(inputRef, draft, setDraft, props.suggestionLimit);
  const busy = status === 'interpreting';

  const onChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setDraft(event.target.value);
    auto.update(event.target.value, event.target.selectionStart ?? event.target.value.length, true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (auto.onKeyDown(event)) {
      event.preventDefault();
      return;
    }
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    } else if (event.key === 'Escape' && busy) {
      event.preventDefault();
      cancel();
    }
  };

  const syncCaret = (): void => {
    const input = inputRef.current;
    if (input) auto.update(input.value, input.selectionStart ?? input.value.length);
  };

  return (
    <form
      className={props.className ?? 'pragma-askbar'}
      data-pragma-askbar=""
      data-busy={busy ? '' : undefined}
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label htmlFor={`${id}-input`} className="pragma-visually-hidden">
        {props.label ?? 'Ask about this table'}
      </label>
      <input
        ref={inputRef}
        id={`${id}-input`}
        className="pragma-askbar__input"
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={auto.open}
        aria-controls={listId}
        aria-activedescendant={auto.open ? optionId(auto.activeIndex) : undefined}
        aria-busy={busy}
        autoComplete="off"
        spellCheck={false}
        placeholder={props.placeholder ?? 'Try: active users older than 25, newest first — type @ for columns'}
        value={draft}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onClick={syncCaret}
        onKeyUp={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') syncCaret();
        }}
        onBlur={() => {
          // Allow option clicks (mousedown) to land before closing.
          setTimeout(auto.close, 100);
        }}
        autoFocus={props.autoFocus}
      />
      <ul id={listId} role="listbox" aria-label="Column suggestions" className="pragma-askbar__listbox" hidden={!auto.open}>
        {auto.open &&
          auto.suggestions.map((suggestion, index) => (
            <li
              key={`${suggestion.kind}:${suggestion.id}`}
              id={optionId(index)}
              role="option"
              aria-selected={index === auto.activeIndex}
              className="pragma-askbar__option"
              data-active={index === auto.activeIndex ? '' : undefined}
              onMouseDown={(event) => {
                event.preventDefault();
                auto.select(suggestion);
              }}
              onMouseEnter={() => {
                auto.setActiveIndex(index);
              }}
            >
              {props.renderSuggestion ? (
                props.renderSuggestion(suggestion)
              ) : (
                <>
                  <span className="pragma-askbar__option-label">{suggestion.label}</span>
                  <span className="pragma-askbar__option-meta">
                    {suggestion.kind === 'resource' ? 'table' : suggestion.type}
                    {suggestion.matchedAlias ? ` · “${suggestion.matchedAlias}”` : ''}
                  </span>
                </>
              )}
            </li>
          ))}
      </ul>
      {busy ? (
        <button type="button" className="pragma-askbar__button" onClick={cancel}>
          {props.cancelLabel ?? 'Cancel'}
        </button>
      ) : (
        <button type="submit" className="pragma-askbar__button" disabled={draft.trim() === ''}>
          {props.submitLabel ?? 'Apply'}
        </button>
      )}
    </form>
  );
}
