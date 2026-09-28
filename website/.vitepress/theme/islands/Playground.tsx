import {
  AskBar,
  ClarificationPrompt,
  Explanation,
  Feedback,
  PragmaProvider,
  QueryChips,
  usePragma,
} from '@avinash-baraiya/pragma-react';
import { usePragmaTable } from '@avinash-baraiya/pragma-tanstack/react';
import { useState, type ReactNode } from 'react';
import { generateCustomers, type Customer } from '../../../../examples/tanstack-react/src/data';
import { customersSchema, engine, timezone } from './engine';
import { JsonView } from './JsonView';

const data = generateCustomers(500);

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});
const date = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' });
const formatDate = (value: unknown): string =>
  typeof value === 'string' ? date.format(new Date(value)) : '—';

type Cell = { getValue: () => unknown };

const columns = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'company', header: 'Company' },
  { accessorKey: 'country', header: 'Country' },
  { accessorKey: 'status', header: 'Status' },
  { accessorKey: 'plan', header: 'Plan' },
  {
    accessorKey: 'verified',
    header: 'Verified',
    cell: (info: Cell) => (info.getValue() === true ? 'Yes' : 'No'),
  },
  {
    accessorKey: 'revenue',
    header: 'Lifetime Revenue',
    cell: (info: Cell) => inr.format(Number(info.getValue())),
  },
  {
    accessorKey: 'createdAt',
    header: 'Signed Up',
    cell: (info: Cell) => formatDate(info.getValue()),
  },
];

// Fewer columns keep the screenshot stage readable without horizontal scrolling.
const stageColumns = columns.filter((column) => column.accessorKey !== 'verified');

const EXAMPLES: readonly { label: string; hint: string }[] = [
  { label: 'active enterprise customers, country is India, newest first', hint: 'local' },
  { label: '@revenue over 10 lakh, sort by revenue desc, 50 per page', hint: 'local' },
  { label: 'joined in the last 30 days and not verified', hint: 'local' },
  { label: 'status is trial or churned', hint: 'local' },
  { label: 'high value accounts', hint: 'model' },
  { label: 'recent customers', hint: 'asks to clarify' },
  { label: 'profitable customers', hint: 'unsupported' },
  { label: 'remove the country filter', hint: 'stateful' },
];

/** `stage` renders a trimmed layout used only to capture the website screenshots. */
export function Playground({ stage = false }: { stage?: boolean }): ReactNode {
  if (stage)
    return (
      <PragmaProvider engine={engine}>
        <div className="pg pg--stage">
          <AskBar placeholder="e.g. active customers from India, newest first" />
          <ClarificationPrompt />
          <Feedback />
          <QueryChips showPagination />
          <CustomerTable columns={stageColumns} />
          <div className="pg__aside">
            <Explanation />
            <QueryInspector />
          </div>
        </div>
      </PragmaProvider>
    );
  return (
    <PragmaProvider engine={engine}>
      <div className="pg pg--full">
        <div className="pg__main">
          <AskBar
            autoFocus
            placeholder="Ask anything… e.g. active customers from India, newest first"
          />
          <Examples />
          <ClarificationPrompt />
          <Feedback />
          <QueryChips showPagination />
          <CustomerTable columns={columns} />
          <p className="pg__hint">
            500 sample customers · timezone {timezone} · runs entirely in your browser
          </p>
        </div>
        <Inspector />
      </div>
    </PragmaProvider>
  );
}

/** What happened under the hood: explanation, payload and the raw result. */
function Inspector(): ReactNode {
  const { query, lastResult } = usePragma();
  const [tab, setTab] = useState<'explain' | 'payload' | 'result'>('explain');
  const meta = lastResult?.meta;
  return (
    <aside className="pg__side" aria-label="Inspector">
      <div className="pg__meta">
        {meta ? (
          <>
            <span className={`pg__status pg__status--${lastResult.status}`}>
              {lastResult.status.replace('_', ' ')}
            </span>
            <span>
              {meta.parser === 'llm' ? 'model' : meta.parser === 'cache' ? 'cache' : 'local parser'}
            </span>
            <span>
              {meta.latencyMs < 10 ? meta.latencyMs.toFixed(1) : Math.round(meta.latencyMs)} ms
            </span>
          </>
        ) : (
          <span>Run an instruction to inspect it</span>
        )}
      </div>
      <div className="pg__tabs" role="tablist" aria-label="Inspector view">
        {(
          [
            ['explain', 'Explanation'],
            ['payload', 'TableQuery'],
            ['result', 'Result'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => {
              setTab(id);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="pg__panel" role="tabpanel">
        {tab === 'explain' && <Explanation title="Interpreted as" />}
        {tab === 'payload' && <JsonView value={query} />}
        {tab === 'result' &&
          (lastResult ? (
            <JsonView value={summarize(lastResult)} />
          ) : (
            <p className="pg__muted">No instruction yet.</p>
          ))}
      </div>
    </aside>
  );
}

/** The parts of an InterpretResult worth showing (not the full query again). */
function summarize(result: NonNullable<ReturnType<typeof usePragma>['lastResult']>): unknown {
  const { meta } = result;
  const base = {
    status: result.status,
    parser: meta.parser,
    latencyMs: Math.round(meta.latencyMs * 10) / 10,
  };
  switch (result.status) {
    case 'ok':
      return { ...base, mutations: result.mutations, warnings: result.warnings };
    case 'needs_clarification':
      return { ...base, ambiguities: result.ambiguities };
    default:
      return {
        ...base,
        errors: result.errors,
        ...('suggestions' in result ? { suggestions: result.suggestions } : {}),
      };
  }
}

function Examples(): ReactNode {
  const { submit, setDraft, status } = usePragma();
  return (
    <nav className="pg__examples" aria-label="Example instructions">
      {EXAMPLES.map((example) => (
        <button
          key={example.label}
          type="button"
          className="pg__example"
          disabled={status === 'interpreting'}
          onClick={() => {
            setDraft(example.label);
            void submit(example.label);
          }}
        >
          {example.label}
          <span className="pg__example-hint">{example.hint}</span>
        </button>
      ))}
    </nav>
  );
}

function CustomerTable({ columns }: { columns: typeof stageColumns }): ReactNode {
  const { query, setQuery } = usePragma();
  const { table, rowCount } = usePragmaTable<Customer>({
    schema: customersSchema,
    query,
    onQueryChange: setQuery,
    data,
    columns,
  });
  const { pageIndex, pageSize } = table.state.pagination;

  return (
    <section className="pg__table" aria-label="Customers table">
      <div className="pg__scroll">
        <table>
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      aria-sort={
                        sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'
                      }
                    >
                      <button
                        type="button"
                        className="pg__th"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        <table.FlexRender header={header} />
                        <span aria-hidden="true">
                          {sorted === 'asc' ? ' ▲' : sorted === 'desc' ? ' ▼' : ''}
                        </span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id}>
                {row.getAllCells().map((cell) => (
                  <td key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
            {rowCount === 0 && (
              <tr>
                <td colSpan={columns.length} className="pg__empty">
                  No customers match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <footer className="pg__pager">
        <span>
          {rowCount === 0 ? 0 : pageIndex * pageSize + 1}–
          {Math.min(rowCount, (pageIndex + 1) * pageSize)} of {rowCount}
        </span>
        <button
          type="button"
          onClick={() => {
            table.previousPage();
          }}
          disabled={!table.getCanPreviousPage()}
        >
          Previous
        </button>
        <button
          type="button"
          onClick={() => {
            table.nextPage();
          }}
          disabled={!table.getCanNextPage()}
        >
          Next
        </button>
      </footer>
    </section>
  );
}

/** The standardized payload a backend or any other table library would receive. */
function QueryInspector(): ReactNode {
  const { query, lastResult } = usePragma();
  return (
    <details className="pg__inspector">
      <summary>
        TableQuery payload{lastResult ? ` · answered by ${lastResult.meta.parser}` : ''}
      </summary>
      <pre>{JSON.stringify(query, null, 2)}</pre>
    </details>
  );
}
