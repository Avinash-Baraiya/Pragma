import { defineSchema } from '@avinash-baraiya/pragma-core';

/** Benchmark schema: realistic field names, aliases, enums, currency, dates and a hidden field. */
export const customersSchema = defineSchema({
  schemaVersion: '1',
  resource: 'customers',
  label: 'Customers',
  aliases: ['users', 'people', 'accounts'],
  fields: [
    { id: 'name', label: 'Name', type: 'string', aliases: ['customer name', 'full name'] },
    { id: 'email', label: 'Email', type: 'string', format: 'email' },
    { id: 'company', label: 'Company', type: 'string', aliases: ['organisation', 'organization'] },
    { id: 'country', label: 'Country', type: 'string', aliases: ['nation'] },
    { id: 'city', label: 'City', type: 'string', aliases: ['location'] },
    { id: 'age', label: 'Age', type: 'number' },
    {
      id: 'status',
      label: 'Status',
      type: 'enum',
      values: [
        { value: 'active', label: 'Active' },
        { value: 'trial', label: 'Trial', aliases: ['trialing', 'evaluating'] },
        { value: 'churned', label: 'Churned', aliases: ['cancelled', 'canceled', 'lost'] },
      ],
    },
    {
      id: 'plan',
      label: 'Plan',
      type: 'enum',
      values: [
        { value: 'free', label: 'Free' },
        { value: 'pro', label: 'Pro' },
        { value: 'enterprise', label: 'Enterprise' },
      ],
    },
    { id: 'verified', label: 'Verified', type: 'boolean', aliases: ['kyc done'] },
    {
      id: 'revenue',
      label: 'Lifetime Revenue',
      type: 'number',
      format: 'currency',
      currency: 'INR',
      aliases: ['revenue', 'ltv', 'spend'],
      description: 'Total revenue from the customer, excluding refunds, in INR.',
    },
    { id: 'seats', label: 'Seats', type: 'number', aliases: ['licenses'] },
    { id: 'phone', label: 'Phone', type: 'string', format: 'phone', sortable: false },
    {
      id: 'createdAt',
      label: 'Signed Up',
      type: 'datetime',
      aliases: ['created', 'joined', 'signup date'],
    },
    {
      id: 'lastActiveAt',
      label: 'Last Active',
      type: 'datetime',
      aliases: ['last seen', 'last login'],
    },
    { id: 'internalNotes', label: 'Internal Notes', type: 'string', hidden: true },
  ],
  defaults: { pageSize: 20, recencyField: 'createdAt' },
  capabilities: { maxPageSize: 100 },
});
