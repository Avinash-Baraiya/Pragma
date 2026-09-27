import { describe, expect, it } from 'vitest';
import { MemoryCache } from './cache.js';

describe('MemoryCache', () => {
  it('stores and returns values', () => {
    const cache = new MemoryCache<number>();
    expect(cache.get('a')).toBeUndefined();
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    expect(cache.size).toBe(1);
  });

  it('evicts the least recently used entry', () => {
    const cache = new MemoryCache<number>({ maxEntries: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a'); // a is now most recent
    cache.set('c', 3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
  });

  it('expires entries after the TTL', () => {
    let now = 1000;
    const cache = new MemoryCache<number>({ ttlMs: 100, now: () => now });
    cache.set('a', 1);
    now = 1099;
    expect(cache.get('a')).toBe(1);
    now = 1100;
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('overwrites, clamps capacity to at least one, and clears', () => {
    const cache = new MemoryCache<number>({ maxEntries: 0 });
    cache.set('a', 1);
    cache.set('a', 2);
    expect(cache.get('a')).toBe(2);
    cache.set('b', 3);
    expect(cache.size).toBe(1);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
