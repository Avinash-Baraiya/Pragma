import {
  conformanceCases,
  conformanceDataset,
  conformanceSchema,
  NOW,
  referenceIds,
  referenceTotal,
  type Person,
} from '@pragma/conformance';
import {
  columnFilteringFeature,
  constructTable,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
} from '@tanstack/table-core';
import { storeReactivityBindings } from '@tanstack/table-core/store-reactivity-bindings';
import { describe, expect, it } from 'vitest';
import { withPragmaColumns } from './columns.js';
import { executeForTable } from './controlled.js';
import { pragmaGlobalFilterFn } from './fns.js';
import { toTanStackState } from './state.js';

const features = tableFeatures({
  coreReactivityFeature: storeReactivityBindings(),
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});

const baseColumns = conformanceSchema.fields.map((f) => ({ accessorKey: f.id, header: f.label }));
const columns = withPragmaColumns(baseColumns, conformanceSchema, { now: () => NOW });
const globalFilterFn = pragmaGlobalFilterFn(conformanceSchema, { now: () => NOW });

function nativeIds(query: (typeof conformanceCases)[number]['query']): {
  ids: number[];
  total: number;
} {
  const state = toTanStackState(query);
  const table = constructTable({
    features,
    columns: columns as never,
    data: conformanceDataset as Person[],
    getRowId: (row: Person) => String(row.id),
    getColumnCanGlobalFilter: () => true,
    globalFilterFn: globalFilterFn as never,
    state: {
      sorting: state.sorting,
      columnFilters: state.columnFilters,
      globalFilter: state.globalFilter,
      pagination: state.pagination ?? { pageIndex: 0, pageSize: 100 },
    },
  } as never) as unknown as {
    getRowModel: () => { rows: { original: Person }[] };
    getPrePaginatedRowModel: () => { rows: unknown[] };
  };
  return {
    ids: table.getRowModel().rows.map((r) => r.original.id),
    total: table.getPrePaginatedRowModel().rows.length,
  };
}

describe('conformance: TanStack native row models', () => {
  it('has a meaningful dataset', () => {
    expect(conformanceDataset).toHaveLength(120);
    expect(conformanceDataset.some((r) => r.age === null)).toBe(true);
  });

  for (const testCase of conformanceCases.filter((c) => c.needsNullsFirst !== true)) {
    it(testCase.name, () => {
      const expected = referenceIds(testCase);
      const actual = nativeIds(testCase.query);
      expect(actual.ids).toEqual(expected);
      expect(actual.total).toBe(referenceTotal(testCase));
    });
  }

  it('non-trivial cases actually select subsets (guards against vacuous passes)', () => {
    const sizes = conformanceCases.map((c) => referenceTotal(c));
    expect(sizes.filter((n) => n > 0 && n < conformanceDataset.length).length).toBeGreaterThan(20);
  });
});

describe('conformance: controlled mode (executeForTable)', () => {
  for (const testCase of conformanceCases) {
    it(testCase.name, () => {
      const result = executeForTable(conformanceDataset, testCase.query, {
        schema: conformanceSchema,
        now: NOW,
      });
      expect(result.rows.map((r) => r.id)).toEqual(referenceIds(testCase));
      expect(result.rowCount).toBe(referenceTotal(testCase));
    });
  }
});
