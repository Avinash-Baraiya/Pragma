import { generateCustomers } from '../../../../examples/tanstack-react/src/data';

export type { Customer } from '../../../../examples/tanstack-react/src/data';

/** 500 seeded customers, identical on every load. */
export const customers = generateCustomers(500);

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});
const date = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' });

export const formatCurrency = (value: unknown): string => inr.format(Number(value));
export const formatDate = (value: unknown): string =>
  typeof value === 'string' ? date.format(new Date(value)) : '—';
