import { defineSchema, sequentialIds, type TableQuery } from '@pragma/core';
import { createEngine, createModelInterpreter, type Engine } from '@pragma/interpreter';
import { mock, mockProvider } from '@pragma/providers/mock';
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AskBar } from './AskBar.js';
import { ClarificationPrompt, Explanation, Feedback, QueryChips } from './components.js';
import { PragmaProvider, usePragma } from './context.js';

const schema = defineSchema({
  schemaVersion: '1',
  resource: 'users',
  fields: [
    { id: 'name', label: 'Name', type: 'string' },
    { id: 'age', label: 'Age', type: 'number' },
    { id: 'country', label: 'Country', type: 'string', aliases: ['nation'] },
    { id: 'createdAt', label: 'Created At', type: 'datetime', aliases: ['joined'] },
    { id: 'salary', label: 'Salary', type: 'number', hidden: true },
  ],
  defaults: { recencyField: 'createdAt' },
});

function makeEngine(latencyMs = 0): Engine {
  const provider = mockProvider({
    latencyMs,
    rules: [{ match: /indian/i, output: mock.output([mock.filter('country', 'eq', 'India')]) }],
  });
  return createEngine({
    schema,
    timezone: 'UTC',
    idGenerator: sequentialIds(),
    interpreter: createModelInterpreter({ provider }),
  });
}

function Ui({ engine, children }: { engine: Engine; children?: ReactNode }): ReactNode {
  return (
    <PragmaProvider engine={engine}>
      <AskBar />
      <QueryChips />
      <Explanation />
      <ClarificationPrompt />
      <Feedback />
      {children}
    </PragmaProvider>
  );
}

async function expectAccessible(container: HTMLElement): Promise<void> {
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

describe('AskBar autocomplete', () => {
  it('suggests columns locally as a combobox and inserts the selection', async () => {
    const user = userEvent.setup();
    const { container } = render(<Ui engine={makeEngine()} />);
    const input = screen.getByRole('combobox', { name: 'Ask about this table' });
    expect(input).toHaveAttribute('aria-expanded', 'false');

    await user.type(input, 'show @co');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    const listbox = screen.getByRole('listbox', { name: 'Column suggestions' });
    const options = within(listbox).getAllByRole('option');
    expect(options[0]).toHaveTextContent('Country');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0]!.id);
    expect(within(listbox).queryByText('Salary')).toBeNull();
    await expectAccessible(container);

    await user.keyboard('{Enter}');
    expect(input).toHaveValue('show @country ');
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('navigates with arrows, closes with Escape and selects by click', async () => {
    const user = userEvent.setup();
    render(<Ui engine={makeEngine()} />);
    const input = screen.getByRole('combobox');
    await user.type(input, '@');
    const count = screen.getAllByRole('option').length;
    await user.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(screen.getAllByRole('option')[count - 1]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('option')).toBeNull();
    await user.keyboard('{ArrowLeft}{ArrowRight}');
    expect(screen.queryByRole('option')).toBeNull(); // caret moves keep it closed
    await user.type(input, 'na'); // typing reopens it
    await user.pointer({
      keys: '[MouseLeft>]',
      target: screen.getByRole('option', { name: /Name/ }),
    });
    expect(input).toHaveValue('@name ');
  });

  it('matches aliases and shows why', async () => {
    const user = userEvent.setup();
    render(<Ui engine={makeEngine()} />);
    await user.type(screen.getByRole('combobox'), '@joi');
    expect(screen.getByRole('option')).toHaveTextContent('Created At');
    expect(screen.getByRole('option')).toHaveTextContent('“joined”');
  });
});

describe('interpretation flow', () => {
  it('applies deterministic instructions, shows chips and explanation, and clears the draft', async () => {
    const user = userEvent.setup();
    const { container } = render(<Ui engine={makeEngine()} />);
    const input = screen.getByRole('combobox');
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    await user.type(input, 'age > 25 and country is India{Enter}');
    const chips = await screen.findByRole('list', { name: 'Active filters' });
    expect(
      within(chips)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Age > 25×', 'Country = "India"×']);
    expect(screen.getByRole('heading', { name: 'Interpreted as' })).toBeInTheDocument();
    expect(input).toHaveValue('');
    await expectAccessible(container);
  });

  it('removes a chip locally and clears everything', async () => {
    const user = userEvent.setup();
    const engine = makeEngine();
    const interpret = vi.spyOn(engine, 'interpret');
    render(<Ui engine={engine} />);
    await user.type(
      screen.getByRole('combobox'),
      'age > 25 and country is India, sort by name{Enter}',
    );
    await screen.findByRole('button', { name: 'Remove filter: Age > 25' });
    await user.click(screen.getByRole('button', { name: 'Remove filter: Age > 25' }));
    expect(screen.queryByText('Age > 25')).toBeNull();
    await user.click(
      screen.getByRole('button', { name: 'Remove sort: Sorted by Name (ascending)' }),
    );
    expect(screen.queryByText(/Sorted by Name/)).toBeNull();
    expect(interpret).toHaveBeenCalledTimes(1);
    await user.type(screen.getByRole('combobox'), 'search rahul and age > 1{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Remove search: Search "rahul"' }));
    await user.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(screen.queryByRole('list', { name: 'Active filters' })).toBeNull();
  });

  it('asks for clarification and resolves it without another model call', async () => {
    const user = userEvent.setup();
    const { container } = render(<Ui engine={makeEngine()} />);
    await user.type(screen.getByRole('combobox'), 'recent users{Enter}');
    const group = await screen.findByRole('group', { name: 'What does "recent" mean?' });
    expect(within(group).getByRole('radio', { name: 'Last 30 days' })).toBeChecked();
    await expectAccessible(container);
    await user.click(within(group).getByRole('radio', { name: 'Last 7 days' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    const chips = await screen.findByRole('list', { name: 'Active filters' });
    expect(within(chips).getByText('Created At in the last 7 days')).toBeInTheDocument();
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('can dismiss a clarification', async () => {
    const user = userEvent.setup();
    render(<Ui engine={makeEngine()} />);
    await user.type(screen.getByRole('combobox'), 'recent users{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('explains unsupported requests and inserts suggestions', async () => {
    const user = userEvent.setup();
    const { container } = render(<Ui engine={makeEngine()} />);
    const input = screen.getByRole('combobox');
    await user.type(input, '@nme contains x{Enter}');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Unknown field "@nme".');
    await expectAccessible(container);
    await user.clear(input);
    await user.click(within(alert).getByRole('button', { name: '@name' }));
    expect(input).toHaveValue('@name ');
  });

  it('shows warnings for impossible filters', async () => {
    const user = userEvent.setup();
    render(<Ui engine={makeEngine()} />);
    await user.type(screen.getByRole('combobox'), 'age > 30 and age < 20{Enter}');
    expect(await screen.findByRole('list', { name: 'Warnings' })).toHaveTextContent(
      'cannot all be true',
    );
  });

  it('uses the model when needed, with cancel while busy', async () => {
    const user = userEvent.setup();
    render(<Ui engine={makeEngine(10_000)} />);
    const input = screen.getByRole('combobox');
    await user.type(input, 'show Indian users{Enter}');
    expect(input).toHaveAttribute('aria-busy', 'true');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(input).toHaveAttribute('aria-busy', 'false');
    expect(screen.queryByRole('list', { name: 'Active filters' })).toBeNull();
  });

  it('applies model results', async () => {
    const user = userEvent.setup();
    render(<Ui engine={makeEngine()} />);
    await user.type(screen.getByRole('combobox'), 'show Indian users{Enter}');
    const chips = await screen.findByRole('list', { name: 'Active filters' });
    expect(within(chips).getByText('Country = "India"')).toBeInTheDocument();
  });

  it('cancels with Escape while busy and ignores empty submissions', async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    render(
      <PragmaProvider engine={makeEngine(10_000)} onResult={onResult}>
        <AskBar />
      </PragmaProvider>,
    );
    const input = screen.getByRole('combobox');
    await user.type(input, '   {Enter}');
    expect(onResult).not.toHaveBeenCalled();
    await user.type(input, 'show Indian users{Enter}');
    await user.keyboard('{Escape}');
    expect(input).toHaveAttribute('aria-busy', 'false');
  });
});

describe('PragmaProvider', () => {
  it('supports a controlled query and reports changes', async () => {
    const changes: TableQuery[] = [];
    function Controlled(): ReactNode {
      const [query, setQuery] = useState(() => makeEngine().initialQuery());
      return (
        <PragmaProvider
          engine={makeEngine()}
          query={query}
          onQueryChange={(q) => {
            changes.push(q);
            setQuery(q);
          }}
        >
          <AskBar />
          <QueryChips />
        </PragmaProvider>
      );
    }
    const user = userEvent.setup();
    render(<Controlled />);
    await user.type(screen.getByRole('combobox'), 'age > 5{Enter}');
    await screen.findByText('Age > 5');
    expect(changes).toHaveLength(1);
  });

  it('drops superseded results when a newer instruction is submitted', async () => {
    const engine = makeEngine(50);
    const { result } = renderHook(() => usePragma(), {
      wrapper: ({ children }) => <PragmaProvider engine={engine}>{children}</PragmaProvider>,
    });
    let first: Promise<unknown> | undefined;
    act(() => {
      first = result.current.submit('show Indian users');
    });
    await act(async () => {
      await result.current.submit('age > 3');
    });
    await act(async () => {
      await first;
    });
    await waitFor(() => {
      expect(result.current.explanation.map((e) => e.text)).toEqual([
        'Age > 3',
        'Page 1, 20 per page',
      ]);
    });
    expect(result.current.resolve({})).toBeUndefined();
  });

  it('throws a clear error outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(() => usePragma())).toThrow(/inside <PragmaProvider>/);
    spy.mockRestore();
  });
});
