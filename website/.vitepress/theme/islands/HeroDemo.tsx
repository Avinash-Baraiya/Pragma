import { executeQuery } from '@avinash-baraiya/pragma-core';
import { AskBar, PragmaProvider, QueryChips, usePragma } from '@avinash-baraiya/pragma-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { customers, formatCurrency, formatDate } from './data';
import { customersSchema, createDemoEngine } from './engine';
import { JsonView } from './JsonView';

/** A scripted tour that shows statefulness: each step builds on the previous query. */
const SCRIPT = [
  'active enterprise customers, country is India',
  'sort by revenue desc',
  'joined in the last 180 days',
  'remove the country filter',
  'high value accounts',
  'reset',
];

const TYPE_MS = 32;
const HOLD_MS = 2600;

export function HeroDemo(): ReactNode {
  const engine = useMemo(() => createDemoEngine(), []);
  return (
    <PragmaProvider engine={engine}>
      <HeroCard />
    </PragmaProvider>
  );
}

function HeroCard(): ReactNode {
  const { query, lastResult, setDraft, submit } = usePragma();
  const [view, setView] = useState<'table' | 'json'>('table');
  const [autoplay, setAutoplay] = useState(true);
  const stopped = useRef(false);

  // Typewriter autoplay; stops for good as soon as the visitor interacts.
  useEffect(() => {
    if (!autoplay) return;
    let cancelled = false;
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    void (async () => {
      await sleep(900);
      for (let step = 0; !cancelled; step = (step + 1) % SCRIPT.length) {
        const text = SCRIPT[step]!;
        for (let i = 1; i <= text.length && !cancelled; i++) {
          setDraft(text.slice(0, i));
          await sleep(TYPE_MS);
        }
        if (cancelled) return;
        await submit(text);
        await sleep(HOLD_MS);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [autoplay, setDraft, submit]);

  const stop = () => {
    if (stopped.current) return;
    stopped.current = true;
    setAutoplay(false);
    setDraft('');
  };

  const result = useMemo(
    () =>
      executeQuery(
        customers,
        { ...query, pagination: { type: 'page', page: 1, pageSize: 6 } },
        { schema: customersSchema },
      ),
    [query],
  );
  const meta = lastResult?.meta;

  return (
    <div className="hd" onPointerDown={stop} onKeyDown={stop}>
      <div className="hd__bar">
        <span className="hd__dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="hd__title">customers · {customers.length} rows</span>
        {meta && (
          <span className={`hd__badge hd__badge--${meta.parser}`}>
            {meta.parser === 'llm' ? 'model' : meta.parser === 'cache' ? 'cached' : 'local'} ·{' '}
            {meta.latencyMs < 10 ? meta.latencyMs.toFixed(1) : Math.round(meta.latencyMs)} ms
          </span>
        )}
      </div>
      <div className="hd__body">
        <AskBar placeholder="Ask anything about customers… (type @ for columns)" />
        <QueryChips />
        <div className="hd__tabs" role="tablist" aria-label="Result view">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'table'}
            onClick={() => setView('table')}
          >
            Table <span>{result.total}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'json'}
            onClick={() => setView('json')}
          >
            TableQuery JSON
          </button>
          {autoplay && <span className="hd__auto">● Live demo · click to try it yourself</span>}
        </div>
        {view === 'table' ? (
          <div className="hd__table" role="tabpanel">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Country</th>
                  <th>Status</th>
                  <th>Plan</th>
                  <th className="num">Revenue</th>
                  <th>Signed up</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td>{row.country}</td>
                    <td>
                      <span className={`hd__pill hd__pill--${row.status}`}>{row.status}</span>
                    </td>
                    <td>{row.plan}</td>
                    <td className="num">{formatCurrency(row.revenue)}</td>
                    <td>{formatDate(row.createdAt)}</td>
                  </tr>
                ))}
                {result.total === 0 && (
                  <tr>
                    <td colSpan={6} className="hd__empty">
                      No customers match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div role="tabpanel">
            <JsonView value={stripIds(query)} className="hd__json" />
          </div>
        )}
      </div>
    </div>
  );
}

/** Node ids are random; hiding them keeps the demo payload readable. */
function stripIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripIds);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'id')
        .map(([key, v]) => [key, stripIds(v)]),
    );
  return value;
}
