import { defineSchema } from '@avinash-baraiya/pragma-core';

/**
 * The table schema is shared by the browser (autocomplete, validation,
 * execution) and the server (model prompt, validation). Only metadata — never
 * row data — is sent to a language model.
 */
export const customersSchema = defineSchema({
  schemaVersion: '1',
  resource: 'customers',
  label: 'Customers',
  aliases: ['users', 'people', 'accounts'],
  description: 'B2B customer accounts of an Indian SaaS company.',
  fields: [
    { id: 'name', label: 'Name', type: 'string', aliases: ['customer', 'full name'] },
    { id: 'email', label: 'Email', type: 'string', format: 'email' },
    {
      id: 'company',
      label: 'Company',
      type: 'string',
      aliases: ['organisation', 'organization', 'org'],
    },
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
    { id: 'seats', label: 'Seats', type: 'number', aliases: ['licenses', 'users count'] },
    { id: 'phone', label: 'Phone', type: 'string', format: 'phone', sortable: false },
    {
      id: 'createdAt',
      label: 'Signed Up',
      type: 'datetime',
      aliases: ['created', 'joined', 'signup date', 'registration date'],
    },
    {
      id: 'lastActiveAt',
      label: 'Last Active',
      type: 'datetime',
      aliases: ['last seen', 'last login'],
    },
    { id: 'internalNotes', label: 'Internal Notes', type: 'string', hidden: true },
  ],
  defaults: {
    pageSize: 20,
    recencyField: 'createdAt',
    sort: [{ field: 'createdAt', direction: 'desc' }],
  },
  capabilities: { maxPageSize: 100 },
});
