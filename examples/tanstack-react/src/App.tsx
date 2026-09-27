import { createEngine } from '@pragma/interpreter';
import { remoteInterpreter } from '@pragma/providers/remote';
import {
  AskBar,
  ClarificationPrompt,
  Explanation,
  Feedback,
  PragmaProvider,
  QueryChips,
  usePragma,
} from '@pragma/react';
import { usePragmaTable } from '@pragma/tanstack/react';
import type { ReactNode } from 'react';
import { generateCustomers, type Customer } from './data.js';
import { customersSchema } from './schema.js';

// Stable, module-level inputs (TanStack and Pragma both rely on stable references).
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const engine = createEngine({
  schema: customersSchema,
  timezone,
  ambiguity: 'ask',
  // Instructions the deterministic parser cannot fully handle go to the server,
  // which holds the model credentials.
  interpreter: remoteInterpreter({ url: '/api/pragma' }),
});

const data = generateCustomers(500);

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});
const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const formatDate = (value: unknown): string =>
  typeof value === 'string' ? date.format(new Date(value)) : '—';
const text = (value: unknown): string =>
  typeof value === 'string' && value !== ''
    ? value
    : typeof value === 'number'
      ? String(value)
      : '—';

const columns = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'company', header: 'Company' },
  { accessorKey: 'country', header: 'Country' },
  {
    accessorKey: 'city',
    header: 'City',
    cell: (info: { getValue: () => unknown }) => text(info.getValue()),
  },
  { accessorKey: 'status', header: 'Status' },
  { accessorKey: 'plan', header: 'Plan' },
  {
    accessorKey: 'verified',
    header: 'Verified',
    cell: (info: { getValue: () => unknown }) => (info.getValue() === true ? 'Yes' : 'No'),
  },
  { accessorKey: 'seats', header: 'Seats' },
  {
    accessorKey: 'revenue',
    header: 'Lifetime Revenue',
    cell: (info: { getValue: () => unknown }) => inr.format(Number(info.getValue())),
  },
  {
    accessorKey: 'createdAt',
    header: 'Signed Up',
    cell: (info: { getValue: () => unknown }) => formatDate(info.getValue()),
  },
  {
    accessorKey: 'lastActiveAt',
    header: 'Last Active',
    cell: (info: { getValue: () => unknown }) => formatDate(info.getValue()),
  },
];

const EXAMPLES: readonly { label: string; hint: string }[] = [
  { label: 'active enterprise customers, country is India, newest first', hint: 'deterministic' },
  { label: '@revenue over 10 lakh, sort by revenue desc, 50 per page', hint: 'deterministic' },
  { label: 'joined in the last 30 days and not verified', hint: 'deterministic' },
  { label: 'status is trial or churned', hint: 'deterministic' },
  { label: 'show Indian customers', hint: 'model' },
  { label: 'high value accounts', hint: 'model' },
  { label: 'recent customers', hint: 'asks to clarify' },
  { label: 'profitable customers', hint: 'unsupported' },
  { label: 'customers with no phone', hint: 'deterministic' },
  { label: 'remove the country filter', hint: 'stateful' },
];

export function App(): ReactNode {
  return (
    <PragmaProvider engine={engine}>
      <main className="page">
        <header className="page__header">
          <h1>Customers</h1>
          <p className="page__subtitle">
            Ask in plain language. Type <kbd>@</kbd> to reference a column. Timezone: {timezone}.
          </p>
        </header>
        <AskBar autoFocus />
        <Examples />
        <ClarificationPrompt />
        <Feedback />
        <QueryChips showPagination />
        <div className="page__grid">
          <CustomerTable />
          <aside className="page__aside">
            <Explanation />
            <QueryInspector />
          </aside>
        </div>
      </main>
    </PragmaProvider>
  );
}

function Examples(): ReactNode {
  const { submit, setDraft, status } = usePragma();
  return (
    <nav className="examples" aria-label="Example instructions">
      {EXAMPLES.map((example) => (
        <button
          key={example.label}
          type="button"
          className="examples__item"
          disabled={status === 'interpreting'}
          onClick={() => {
            setDraft(example.label);
            void submit(example.label);
          }}
        >
          {example.label}
          <span className="examples__hint">{example.hint}</span>
        </button>
      ))}
    </nav>
  );
}

function CustomerTable(): ReactNode {
  const { query, setQuery } = usePragma();
  const { table, rowCount } = usePragmaTable<Customer>({
    schema: customersSchema,
    query,
    onQueryChange: setQuery,
    data,
    columns: columns,
  });
  const { pageIndex, pageSize } = table.state.pagination;

  return (
    <section className="table-card" aria-label="Customers table">
      <div className="table-scroll">
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
                        className="th-button"
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
                <td colSpan={columns.length} className="empty">
                  No customers match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <footer className="pager">
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

/** Shows the standardized payload — what a backend or any other table library would receive. */
function QueryInspector(): ReactNode {
  const { query, lastResult } = usePragma();
  return (
    <details className="inspector">
      <summary>TableQuery payload{lastResult ? ` · ${lastResult.meta.parser}` : ''}</summary>
      <pre>{JSON.stringify(query, null, 2)}</pre>
    </details>
  );
}
