import {
  OPERATOR_ARITY,
  OPERATOR_LABELS,
  OPERATORS_BY_TYPE,
  type FieldType,
  type InterpretResult,
  type Operator,
} from '@avinash-baraiya/pragma-core';
import { useMemo, useState, type ReactNode } from 'react';
import { createDemoEngine } from './engine';
import { JsonView } from './JsonView';

const TYPES: readonly { type: FieldType; label: string; field: string }[] = [
  { type: 'string', label: 'Text', field: 'country, email, name' },
  { type: 'number', label: 'Number', field: 'seats, revenue' },
  { type: 'enum', label: 'Enum', field: 'status, plan' },
  { type: 'boolean', label: 'Boolean', field: 'verified' },
  { type: 'datetime', label: 'Date & time', field: 'createdAt, lastActiveAt' },
];

/** Example phrases, each verified to parse locally into the operator it illustrates. */
const EXAMPLES: Partial<Record<FieldType, Partial<Record<Operator, string>>>> = {
  string: {
    eq: 'country is India',
    neq: 'country is not India',
    contains: 'email contains gmail',
    notContains: 'email does not contain gmail',
    startsWith: 'name starts with Ra',
    endsWith: 'email ends with gmail.com',
    in: 'country is India or US',
    notIn: 'country not in India, US',
    isEmpty: 'city is empty',
    isNotEmpty: 'city is not empty',
    isNull: 'customers with no phone',
    isNotNull: 'phone is not null',
  },
  number: {
    eq: 'seats is 25',
    neq: 'seats is not 25',
    gt: 'seats over 50',
    gte: 'seats at least 50',
    lt: 'revenue under 1 lakh',
    lte: 'seats at most 10',
    between: 'revenue between 5 lakh and 20 lakh',
    notBetween: 'seats not between 10 and 50',
  },
  enum: {
    eq: 'plan is enterprise',
    neq: 'plan is not free',
    in: 'status is trial or churned',
  },
  boolean: { eq: 'verified customers' },
  datetime: {
    before: 'signed up before 2025-01-01',
    after: 'signed up after 2025-06-30',
    onOrBefore: 'signed up on or before 2025-01-01',
    onOrAfter: 'signed up on or after 2025-01-01',
    last: 'joined in the last 30 days',
    next: 'last active in the next 7 days',
    today: 'signed up today',
    yesterday: 'signed up yesterday',
    thisWeek: 'signed up this week',
    lastWeek: 'signed up last week',
    thisMonth: 'signed up this month',
    lastMonth: 'signed up last month',
    thisYear: 'signed up this year',
  },
};

const ARITY_TEXT: Record<string, string> = {
  none: 'no value',
  single: 'one value',
  range: '[from, to]',
  list: '[a, b, …]',
  duration: '{ amount, unit }',
};

export function OperatorExplorer(): ReactNode {
  const engine = useMemo(() => createDemoEngine(), []);
  const [type, setType] = useState<FieldType>('string');
  const [selected, setSelected] = useState<Operator | undefined>();
  const [result, setResult] = useState<InterpretResult | undefined>();
  const operators = OPERATORS_BY_TYPE[type];
  const current = TYPES.find((t) => t.type === type)!;

  const run = async (op: Operator) => {
    const phrase = EXAMPLES[type]?.[op];
    setSelected(op);
    setResult(phrase ? await engine.interpret(phrase) : undefined);
  };

  const phrase = selected ? EXAMPLES[type]?.[selected] : undefined;
  const filter = result?.status === 'ok' ? result.query.filter : null;
  const condition = filter
    ? (filter.type === 'group' ? filter.children : [filter]).map(({ id: _id, ...rest }) => rest)
    : undefined;

  return (
    <div className="opx">
      <div className="opx__types" role="tablist" aria-label="Field type">
        {TYPES.map((t) => (
          <button
            key={t.type}
            type="button"
            role="tab"
            aria-selected={t.type === type}
            onClick={() => {
              setType(t.type);
              setSelected(undefined);
              setResult(undefined);
            }}
          >
            {t.label}
            <span>{OPERATORS_BY_TYPE[t.type].length}</span>
          </button>
        ))}
      </div>
      <p className="opx__hint">
        {current.label} fields in the demo schema: <code>{current.field}</code>. Pick an operator to
        run its example through the real parser.
      </p>
      <div className="opx__grid">
        {operators.map((op) => {
          const example = EXAMPLES[type]?.[op];
          return (
            <button
              key={op}
              type="button"
              className="opx__op"
              aria-pressed={selected === op}
              onClick={() => void run(op)}
            >
              <span className="opx__label">{OPERATOR_LABELS[op]}</span>
              <code className="opx__name">{op}</code>
              <span className="opx__arity">{ARITY_TEXT[OPERATOR_ARITY[op]]}</span>
              {example ? (
                <span className="opx__example">“{example}”</span>
              ) : (
                <span className="opx__example opx__example--none">set from the UI or API</span>
              )}
            </button>
          );
        })}
      </div>
      {selected && (
        <div className="opx__result" aria-live="polite">
          <div className="opx__result-head">
            <span>
              <code>{selected}</code> ·{' '}
              {phrase ? <>“{phrase}”</> : 'no natural-language example for this type'}
            </span>
            {result && (
              <span className="opx__badge">
                {result.status === 'ok'
                  ? `parsed locally · ${result.meta.latencyMs.toFixed(1)} ms`
                  : result.status}
              </span>
            )}
          </div>
          {condition && <JsonView value={condition.length === 1 ? condition[0] : condition} />}
        </div>
      )}
    </div>
  );
}
