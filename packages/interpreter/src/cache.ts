/** Value or promise of a value. @public */
export type MaybePromise<T> = T | Promise<T>;

/**
 * Storage for interpretations (proposals), keyed by a hash of the normalized
 * instruction, schema, current state and engine version. Implement this to
 * share a cache across processes (e.g. Redis). Values are JSON-serializable.
 *
 * Implementations must never throw for a miss; errors are swallowed by the engine
 * and treated as misses so that a cache outage cannot break interpretation.
 *
 * @public
 */
export interface CacheStore<V> {
  get(key: string): MaybePromise<V | undefined>;
  set(key: string, value: V): MaybePromise<void>;
}

/** @public */
export interface MemoryCacheOptions {
  /** Default 500. */
  readonly maxEntries?: number;
  /** Entry lifetime in ms. Default: no expiry. */
  readonly ttlMs?: number;
  /** Clock for expiry. Default `Date.now`. */
  readonly now?: () => number;
}

/**
 * In-memory LRU cache with optional TTL. Suitable for a single process or browser tab.
 *
 * @public
 */
export class MemoryCache<V> implements CacheStore<V> {
  private readonly entries = new Map<string, { value: V; expires: number }>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: MemoryCacheOptions = {}) {
    this.maxEntries = Math.max(1, options.maxEntries ?? 500);
    this.ttlMs = options.ttlMs ?? Number.POSITIVE_INFINITY;
    this.now = options.now ?? Date.now;
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expires <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // Refresh recency.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expires: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}
