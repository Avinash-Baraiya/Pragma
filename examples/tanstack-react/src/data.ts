/** Seeded demo data: identical on every run, no network needed. */

export interface Customer {
  id: number;
  name: string;
  email: string | null;
  company: string;
  country: string;
  city: string | null;
  age: number | null;
  status: 'active' | 'trial' | 'churned';
  plan: 'free' | 'pro' | 'enterprise';
  verified: boolean;
  revenue: number;
  seats: number;
  phone: string | null;
  createdAt: string;
  lastActiveAt: string | null;
  internalNotes: string;
}

function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = [
  'Aarav',
  'Priya',
  'Rahul',
  'Ananya',
  'Vikram',
  'Sara',
  'John',
  'Mei',
  'Lukas',
  'Fatima',
  'Diego',
  'Emma',
  'Arjun',
  'Kavya',
  'Omar',
  'Noah',
];
const LAST = [
  'Sharma',
  'Patel',
  'Iyer',
  'Reddy',
  'Smith',
  'Chen',
  'Müller',
  'Khan',
  'Garcia',
  'Johnson',
  'Nair',
  'Gupta',
  'Kim',
  'Silva',
];
const COMPANIES = [
  'Acme Corp',
  'Globex',
  'Initech',
  'Umbrella',
  'Stark Industries',
  'Wayne Enterprises',
  'Hooli',
  'Tata Digital',
  'Zoho Labs',
  'Freshworks',
];
const PLACES: [string, string][] = [
  ['India', 'Mumbai'],
  ['India', 'Bengaluru'],
  ['India', 'Delhi'],
  ['India', 'Ahmedabad'],
  ['India', 'Chennai'],
  ['US', 'New York'],
  ['US', 'San Francisco'],
  ['Germany', 'Berlin'],
  ['UK', 'London'],
  ['Singapore', 'Singapore'],
  ['UAE', 'Dubai'],
  ['Brazil', 'São Paulo'],
];

export function generateCustomers(count = 500, now = Date.now()): Customer[] {
  const rand = prng(42);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const out: Customer[] = [];
  for (let id = 1; id <= count; id++) {
    const first = pick(FIRST);
    const last = pick(LAST);
    const [country, city] = pick(PLACES);
    const plan = pick(['free', 'free', 'pro', 'pro', 'enterprise'] as const);
    const status = pick(['active', 'active', 'active', 'trial', 'churned'] as const);
    const seats =
      plan === 'enterprise'
        ? 50 + Math.floor(rand() * 950)
        : plan === 'pro'
          ? 5 + Math.floor(rand() * 45)
          : 1 + Math.floor(rand() * 4);
    const revenue =
      plan === 'free'
        ? 0
        : Math.round(seats * (plan === 'enterprise' ? 12_000 : 6_000) * (0.5 + rand() * 3));
    const createdAt = now - Math.floor(rand() * 720) * 86_400_000 - Math.floor(rand() * 86_400_000);
    const lastActive =
      status === 'churned' && rand() < 0.5
        ? null
        : Math.min(now, createdAt + Math.floor(rand() * (now - createdAt)));
    out.push({
      id,
      name: `${first} ${last}`,
      email:
        rand() < 0.08
          ? null
          : `${first.toLowerCase()}.${last.toLowerCase().replace('ü', 'ue')}@${pick(COMPANIES)
              .toLowerCase()
              .replace(/[^a-z]/g, '')}.com`,
      company: pick(COMPANIES),
      country,
      city: rand() < 0.05 ? null : city,
      age: rand() < 0.1 ? null : 22 + Math.floor(rand() * 40),
      status,
      plan,
      verified: rand() < 0.7,
      revenue,
      seats,
      phone:
        rand() < 0.2 ? null : `+${10 + Math.floor(rand() * 89)} ${Math.floor(1e9 + rand() * 9e9)}`,
      createdAt: new Date(createdAt).toISOString(),
      lastActiveAt: lastActive === null ? null : new Date(lastActive).toISOString(),
      internalNotes: 'confidential',
    });
  }
  return out;
}
