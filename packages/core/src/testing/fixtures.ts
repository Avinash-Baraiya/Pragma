import { defineSchema } from '../schema/define-schema.js';
import type { TableSchema } from '../schema/types.js';

/** Shared test schema. Not part of the public API. */
export const usersSchemaInput: TableSchema = {
  schemaVersion: '1',
  resource: 'users',
  label: 'Users',
  aliases: ['customers', 'people'],
  fields: [
    { id: 'name', label: 'Name', type: 'string' },
    { id: 'email', label: 'Email', type: 'string', format: 'email' },
    { id: 'age', label: 'Age', type: 'number', aliases: ['years old'] },
    { id: 'country', label: 'Country', type: 'string', aliases: ['nation'] },
    {
      id: 'status',
      label: 'Status',
      type: 'enum',
      values: [
        { value: 'active', label: 'Active' },
        { value: 'inactive', label: 'Inactive', aliases: ['disabled'] },
        { value: 'pending', label: 'Pending', aliases: ['awaiting approval'] },
      ],
    },
    { id: 'verified', label: 'Verified', type: 'boolean' },
    { id: 'revenue', label: 'Revenue', type: 'number', format: 'currency', currency: 'INR' },
    {
      id: 'discount',
      label: 'Discount',
      type: 'number',
      format: 'percent',
      percentScale: 'fraction',
    },
    { id: 'phone', label: 'Phone', type: 'string', format: 'phone', sortable: false },
    { id: 'birthDate', label: 'Birth Date', type: 'date', aliases: ['dob', 'birthday'] },
    {
      id: 'createdAt',
      label: 'Created At',
      type: 'datetime',
      aliases: ['signup date', 'joined', 'registration date'],
    },
    { id: 'address.city', label: 'City', type: 'string' },
    { id: 'salary', label: 'Salary', type: 'number', hidden: true },
  ],
  defaults: { pageSize: 20, recencyField: 'createdAt' },
  capabilities: { pagination: ['page', 'offset', 'cursor'], maxPageSize: 100 },
};

export const usersSchema = defineSchema(usersSchemaInput);

export interface UserRow {
  name: string;
  email: string | null;
  age: number | null;
  country: string | null;
  status: 'active' | 'inactive' | 'pending';
  verified: boolean;
  revenue: number;
  discount: number;
  phone: string | null;
  birthDate: string | null;
  createdAt: string;
  address: { city: string | null };
  salary: number;
}

export const userRows: UserRow[] = [
  {
    name: 'Rahul Sharma',
    email: 'rahul@example.com',
    age: 31,
    country: 'India',
    status: 'active',
    verified: true,
    revenue: 500000,
    discount: 0.1,
    phone: '+91-9000000001',
    birthDate: '1994-03-12',
    createdAt: '2024-06-10T08:00:00Z',
    address: { city: 'Mumbai' },
    salary: 10,
  },
  {
    name: 'Priya Patel',
    email: 'priya@example.com',
    age: 24,
    country: 'India',
    status: 'pending',
    verified: false,
    revenue: 120000,
    discount: 0.25,
    phone: null,
    birthDate: '2001-07-01',
    createdAt: '2024-06-14T18:30:00Z',
    address: { city: 'Ahmedabad' },
    salary: 10,
  },
  {
    name: 'John Smith',
    email: 'john@example.com',
    age: 45,
    country: 'US',
    status: 'active',
    verified: true,
    revenue: 900000,
    discount: 0,
    phone: '+1-555-0100',
    birthDate: '1979-11-30',
    createdAt: '2023-12-01T10:00:00Z',
    address: { city: 'Boston' },
    salary: 10,
  },
  {
    name: 'Anna Müller',
    email: null,
    age: null,
    country: 'Germany',
    status: 'inactive',
    verified: false,
    revenue: 0,
    discount: 0.05,
    phone: '',
    birthDate: null,
    createdAt: '2024-01-20T09:15:00Z',
    address: { city: null },
    salary: 10,
  },
  {
    name: 'rahul verma',
    email: 'RAHUL.V@example.com',
    age: 27,
    country: null,
    status: 'active',
    verified: true,
    revenue: 250000,
    discount: 0.15,
    phone: '+91-9000000002',
    birthDate: '1998-06-15',
    createdAt: '2024-06-15T00:30:00Z',
    address: { city: 'Pune' },
    salary: 10,
  },
];
