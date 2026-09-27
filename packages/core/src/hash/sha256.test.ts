import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { sha256, stableStringify } from './sha256.js';

describe('sha256', () => {
  it('matches FIPS 180-4 test vectors', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('agrees with node:crypto on arbitrary unicode input', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 300 }), (text) => {
        expect(sha256(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
      }),
      { numRuns: 200 },
    );
  });
});

describe('stableStringify', () => {
  it('sorts keys recursively and drops undefined', () => {
    expect(stableStringify({ b: 1, a: { d: undefined, c: [3, { z: 1, y: 2 }] } })).toBe('{"a":{"c":[3,{"y":2,"z":1}]},"b":1}');
  });
});
