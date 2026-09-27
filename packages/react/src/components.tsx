import type { Ambiguity, ExplanationItem } from '@pragma/core';
import { useId, useState, type ReactNode } from 'react';
import { usePragma } from './context.js';

/** @public */
export interface QueryChipsProps {
  readonly className?: string;
  /** Accessible name for the chip list. Default "Active filters". */
  readonly label?: string;
  /** Include the pagination item. Default false. */
  readonly showPagination?: boolean;
  /** Show a "Clear all" button when anything is active. Default true. */
  readonly showClearAll?: boolean;
}

/**
 * The current query as removable chips (search, each root-level filter, each
 * sort). Removing a chip is applied locally — no model call.
 *
 * @public
 */
export function QueryChips(props: QueryChipsProps): ReactNode {
  const { explanation, removeFilter, removeSort, clearSearch, reset } = usePragma();
  const items = explanation.filter((i) => i.kind !== 'pagination' || props.showPagination === true);
  const removable = items.filter((i) => i.kind !== 'pagination');
  if (items.length === 0) return null;

  const remove = (item: ExplanationItem): void => {
    if (item.kind === 'filter' && item.nodeId) removeFilter(item.nodeId);
    else if (item.kind === 'sort' && item.field) removeSort(item.field);
    else if (item.kind === 'search') clearSearch();
  };

  return (
    <div className={props.className ?? 'pragma-chips'} data-pragma-chips="">
      <ul aria-label={props.label ?? 'Active filters'} className="pragma-chips__list">
        {items.map((item, index) => (
          <li
            key={`${item.kind}:${item.nodeId ?? item.field ?? index}`}
            className="pragma-chip"
            data-kind={item.kind}
          >
            <span className="pragma-chip__text">{item.text}</span>
            {item.kind !== 'pagination' && (
              <button
                type="button"
                className="pragma-chip__remove"
                aria-label={`Remove ${item.kind === 'sort' ? 'sort' : item.kind === 'search' ? 'search' : 'filter'}: ${item.text}`}
                onClick={() => {
                  remove(item);
                }}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      {props.showClearAll !== false && removable.length > 1 && (
        <button type="button" className="pragma-chips__clear" onClick={reset}>
          Clear all
        </button>
      )}
    </div>
  );
}

/** @public */
export interface ExplanationProps {
  readonly className?: string;
  readonly title?: string;
}

/**
 * "Interpreted as" summary of the current query plus warnings from the last
 * interpretation (e.g. conditions that can never match, assumptions applied).
 * Announced politely to screen readers.
 *
 * @public
 */
export function Explanation(props: ExplanationProps): ReactNode {
  const { explanation, warnings } = usePragma();
  const lines = explanation.filter((i) => i.kind !== 'pagination');
  return (
    <section
      className={props.className ?? 'pragma-explanation'}
      aria-live="polite"
      data-pragma-explanation=""
    >
      {lines.length > 0 && (
        <>
          <h2 className="pragma-explanation__title">{props.title ?? 'Interpreted as'}</h2>
          <ul className="pragma-explanation__list">
            {lines.map((item, index) => (
              <li key={`${item.kind}:${item.nodeId ?? item.field ?? index}`}>{item.text}</li>
            ))}
          </ul>
        </>
      )}
      {warnings.length > 0 && (
        <ul className="pragma-explanation__warnings" aria-label="Warnings">
          {warnings.map((w, index) => (
            <li key={`${w.code}:${index}`} data-code={w.code} className="pragma-warning">
              {w.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** @public */
export interface FeedbackProps {
  readonly className?: string;
}

/**
 * Explains why an instruction could not be applied (unsupported / error) and
 * offers suggestions that insert `@field` references into the ask bar.
 *
 * @public
 */
export function Feedback(props: FeedbackProps): ReactNode {
  const { errors, suggestions, setDraft, draft } = usePragma();
  if (errors.length === 0) return null;
  return (
    <div className={props.className ?? 'pragma-feedback'} role="alert" data-pragma-feedback="">
      <ul className="pragma-feedback__errors">
        {errors.map((e, index) => (
          <li key={`${e.code}:${index}`} data-code={e.code}>
            {e.message}
          </li>
        ))}
      </ul>
      {suggestions.length > 0 && (
        <div className="pragma-feedback__suggestions">
          <span>Try: </span>
          {suggestions
            .filter((s) => s.insertText !== undefined)
            .map((s) => (
              <button
                key={`${s.kind}:${s.field ?? s.label}`}
                type="button"
                className="pragma-feedback__suggestion"
                onClick={() => {
                  setDraft(`${draft.trim()} ${s.insertText ?? ''} `.trimStart());
                }}
              >
                {s.insertText}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

/** @public */
export interface ClarificationPromptProps {
  readonly className?: string;
  readonly applyLabel?: string;
}

/**
 * Asks the user to choose between interpretations of an ambiguous instruction.
 * Each ambiguity is a radio group, pre-selected on its default option; applying
 * resolves locally without another model call.
 *
 * @public
 */
export function ClarificationPrompt(props: ClarificationPromptProps): ReactNode {
  const { clarification, resolve, dismissClarification } = usePragma();
  if (!clarification) return null;
  return (
    <ClarificationForm
      key={clarification.meta.requestId}
      ambiguities={clarification.ambiguities}
      className={props.className ?? 'pragma-clarification'}
      applyLabel={props.applyLabel ?? 'Confirm'}
      onApply={resolve}
      onDismiss={dismissClarification}
    />
  );
}

function ClarificationForm(props: {
  ambiguities: readonly Ambiguity[];
  className: string;
  applyLabel: string;
  onApply: (choices: Readonly<Record<string, string>>) => unknown;
  onDismiss: () => void;
}): ReactNode {
  const baseId = useId();
  const [choices, setChoices] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      props.ambiguities.flatMap((a) => {
        const preferred = a.options.find((o) => o.isDefault === true) ?? a.options[0];
        return preferred ? [[a.id, preferred.id]] : [];
      }),
    ),
  );
  const complete = props.ambiguities.every((a) => choices[a.id] !== undefined);

  return (
    <form
      className={props.className}
      data-pragma-clarification=""
      aria-label="Clarify your request"
      onSubmit={(event) => {
        event.preventDefault();
        if (complete) props.onApply(choices);
      }}
    >
      {props.ambiguities.map((ambiguity, a) => (
        <fieldset key={ambiguity.id} className="pragma-clarification__group">
          <legend>{ambiguity.message}</legend>
          {ambiguity.options.map((option) => {
            const inputId = `${baseId}-${a}-${option.id}`;
            return (
              <div key={option.id} className="pragma-clarification__option">
                <input
                  id={inputId}
                  type="radio"
                  name={`${baseId}-${ambiguity.id}`}
                  value={option.id}
                  checked={choices[ambiguity.id] === option.id}
                  onChange={() => {
                    setChoices((c) => ({ ...c, [ambiguity.id]: option.id }));
                  }}
                />
                <label htmlFor={inputId}>{option.label}</label>
              </div>
            );
          })}
        </fieldset>
      ))}
      <div className="pragma-clarification__actions">
        <button type="submit" disabled={!complete}>
          {props.applyLabel}
        </button>
        <button type="button" onClick={props.onDismiss}>
          Dismiss
        </button>
      </div>
    </form>
  );
}
