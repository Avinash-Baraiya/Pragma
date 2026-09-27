/** Produces ids for filter nodes, ambiguities and requests. Injectable for deterministic tests. @public */
export type IdGenerator = (prefix: string) => string;

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * Default id generator: `<prefix>_<10 random base36 chars>` using
 * `crypto.getRandomValues` (available in browsers, including non-secure contexts,
 * and Node ≥ 20).
 *
 * @public
 */
export const randomId: IdGenerator = (prefix) => {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) out += ALPHABET.charAt(byte % ALPHABET.length);
  return `${prefix}_${out}`;
};

/** Deterministic generator for tests and snapshots: `<prefix>_1`, `<prefix>_2`, ... @public */
export function sequentialIds(): IdGenerator {
  const counters = new Map<string, number>();
  return (prefix) => {
    const next = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, next);
    return `${prefix}_${next}`;
  };
}

/** Assert exhaustiveness in `switch` statements over unions. @internal */
export function assertNever(value: never, message = 'Unexpected value'): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}
