import type {
  ClarificationResult,
  ExplanationItem,
  InterpretResult,
  Mutation,
  PageInfo,
  PragmaIssue,
  PragmaWarning,
  Suggestion,
  TableQuery,
} from '@pragma/core';
import type { Engine } from '@pragma/interpreter';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/** @public */
export type PragmaStatus = 'idle' | 'interpreting';

/** Everything the Pragma UI components (and your own) need. @public */
export interface PragmaContextValue {
  readonly engine: Engine;
  /** The current, validated table query — the single source of truth. */
  readonly query: TableQuery;
  /** Replace the query directly (e.g. from table header interactions). */
  readonly setQuery: (query: TableQuery) => void;
  readonly status: PragmaStatus;
  /** Text in the ask bar (shared so suggestions can insert into it). */
  readonly draft: string;
  readonly setDraft: (text: string) => void;
  /** Interpret an instruction against the current query. Aborts any in-flight request. */
  readonly submit: (instruction?: string) => Promise<InterpretResult | undefined>;
  /** Cancel an in-flight interpretation. */
  readonly cancel: () => void;
  /** The last result (ok, clarification, unsupported or error). */
  readonly lastResult: InterpretResult | undefined;
  /** Pending clarification, if the last instruction was ambiguous. */
  readonly clarification: ClarificationResult | undefined;
  /** Apply chosen clarification options locally (no model call). */
  readonly resolve: (choices: Readonly<Record<string, string>>) => InterpretResult | undefined;
  readonly dismissClarification: () => void;
  /** Apply mutations locally, e.g. removing a chip. */
  readonly apply: (mutations: readonly Mutation[]) => InterpretResult;
  readonly removeFilter: (nodeId: string) => InterpretResult;
  readonly removeSort: (field: string) => InterpretResult;
  readonly clearSearch: () => InterpretResult;
  readonly reset: () => InterpretResult;
  /** Deterministic explanation of the current query. */
  readonly explanation: readonly ExplanationItem[];
  /** Warnings from the last successful result. */
  readonly warnings: readonly PragmaWarning[];
  /** Errors from the last unsupported/error result. */
  readonly errors: readonly PragmaIssue[];
  /** Suggestions from the last unsupported result. */
  readonly suggestions: readonly Suggestion[];
}

const PragmaContext = createContext<PragmaContextValue | undefined>(undefined);

/** @public */
export interface PragmaProviderProps {
  readonly engine: Engine;
  /** Controlled query. Provide together with `onQueryChange`. */
  readonly query?: TableQuery;
  /** Called whenever the query changes (controlled or not). */
  readonly onQueryChange?: (query: TableQuery) => void;
  /** Starting query when uncontrolled. Default: `engine.initialQuery()`. */
  readonly defaultQuery?: TableQuery;
  /** Cursor information for next/previous page with cursor pagination. */
  readonly pageInfo?: PageInfo;
  /** Observe every result (analytics, toasts). */
  readonly onResult?: (result: InterpretResult) => void;
  readonly children?: ReactNode;
}

/**
 * Holds Pragma state for a table: the current query, the draft instruction,
 * the last result and any pending clarification. Interpretations are
 * cancellable, and a new submission aborts the previous one.
 *
 * @public
 */
export function PragmaProvider(props: PragmaProviderProps): ReactNode {
  const { engine, onQueryChange, onResult, pageInfo, children } = props;
  const [internalQuery, setInternalQuery] = useState<TableQuery>(() => props.defaultQuery ?? engine.initialQuery());
  const query = props.query ?? internalQuery;
  const [status, setStatus] = useState<PragmaStatus>('idle');
  const [draft, setDraft] = useState('');
  const [lastResult, setLastResult] = useState<InterpretResult | undefined>(undefined);
  const [clarification, setClarification] = useState<ClarificationResult | undefined>(undefined);
  const inFlight = useRef<AbortController | undefined>(undefined);
  const latestQuery = useRef(query);
  latestQuery.current = query;

  useEffect(() => () => inFlight.current?.abort(), []);

  const setQuery = useCallback(
    (next: TableQuery) => {
      latestQuery.current = next;
      if (props.query === undefined) setInternalQuery(next);
      onQueryChange?.(next);
    },
    [props.query, onQueryChange],
  );

  const settle = useCallback(
    (result: InterpretResult) => {
      setLastResult(result);
      setClarification(result.status === 'needs_clarification' ? result : undefined);
      if (result.status === 'ok') setQuery(result.query);
      onResult?.(result);
      return result;
    },
    [setQuery, onResult],
  );

  const cancel = useCallback(() => {
    inFlight.current?.abort();
    inFlight.current = undefined;
    setStatus('idle');
  }, []);

  const submit = useCallback(
    async (instruction?: string) => {
      const text = (instruction ?? draft).trim();
      if (text === '') return undefined;
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      setStatus('interpreting');
      try {
        const result = await engine.interpret(text, { currentState: latestQuery.current, signal: controller.signal, ...(pageInfo ? { pageInfo } : {}) });
        // A newer submission (or cancel) superseded this one: drop its result.
        if (inFlight.current !== controller) return undefined;
        const settled = settle(result);
        if (result.status === 'ok') setDraft('');
        return settled;
      } finally {
        if (inFlight.current === controller) {
          inFlight.current = undefined;
          setStatus('idle');
        }
      }
    },
    [draft, engine, pageInfo, settle],
  );

  const apply = useCallback(
    (mutations: readonly Mutation[]) => settle(engine.apply(mutations, { currentState: latestQuery.current, ...(pageInfo ? { pageInfo } : {}) })),
    [engine, pageInfo, settle],
  );

  const resolve = useCallback(
    (choices: Readonly<Record<string, string>>) => {
      if (!clarification) return undefined;
      const result = settle(engine.resolve(clarification, choices, { currentState: latestQuery.current }));
      if (result.status === 'ok') setDraft('');
      return result;
    },
    [clarification, engine, settle],
  );

  const explanation = useMemo(() => engine.explain(query), [engine, query]);

  const value = useMemo<PragmaContextValue>(
    () => ({
      engine,
      query,
      setQuery,
      status,
      draft,
      setDraft,
      submit,
      cancel,
      lastResult,
      clarification,
      resolve,
      dismissClarification: () => {
        setClarification(undefined);
      },
      apply,
      removeFilter: (nodeId) => apply([{ op: 'removeFilter', target: { id: nodeId } }]),
      removeSort: (field) => apply([{ op: 'removeSort', field }]),
      clearSearch: () => apply([{ op: 'clearSearch' }]),
      reset: () => apply([{ op: 'reset' }]),
      explanation,
      warnings: lastResult?.status === 'ok' ? lastResult.warnings : [],
      errors: lastResult?.status === 'unsupported' || lastResult?.status === 'error' ? lastResult.errors : [],
      suggestions: lastResult?.status === 'unsupported' ? lastResult.suggestions : [],
    }),
    [engine, query, setQuery, status, draft, submit, cancel, lastResult, clarification, resolve, apply, explanation],
  );

  return <PragmaContext.Provider value={value}>{children}</PragmaContext.Provider>;
}

/**
 * Access Pragma state and actions. Must be used inside {@link PragmaProvider}.
 *
 * @public
 */
export function usePragma(): PragmaContextValue {
  const value = useContext(PragmaContext);
  if (!value) throw new Error('usePragma must be used inside <PragmaProvider>.');
  return value;
}
