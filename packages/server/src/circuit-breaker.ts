/** @public */
export interface CircuitBreakerOptions {
  /** Consecutive model failures that open the circuit. Default 5. */
  readonly failureThreshold?: number;
  /** How long the circuit stays open before one trial request is allowed. Default 30 000 ms. */
  readonly resetAfterMs?: number;
}

export type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Minimal circuit breaker around the model dependency. While open, the handler
 * serves the deterministic parser only instead of piling requests onto a failing
 * upstream. After `resetAfterMs` a single trial request is let through.
 *
 * @internal
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | undefined;
  private trialInFlight = false;
  private readonly threshold: number;
  private readonly resetAfterMs: number;

  constructor(
    options: CircuitBreakerOptions,
    private readonly now: () => number,
  ) {
    this.threshold = Math.max(1, options.failureThreshold ?? 5);
    this.resetAfterMs = Math.max(0, options.resetAfterMs ?? 30_000);
  }

  get state(): CircuitState {
    if (this.openedAt === undefined) return 'closed';
    return this.now() - this.openedAt >= this.resetAfterMs ? 'half-open' : 'open';
  }

  /** Whether the next request may use the model. Claims the single half-open trial slot. */
  allowModel(): boolean {
    const state = this.state;
    if (state === 'closed') return true;
    if (state === 'half-open' && !this.trialInFlight) {
      this.trialInFlight = true;
      return true;
    }
    return false;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = undefined;
    this.trialInFlight = false;
  }

  recordFailure(): void {
    this.trialInFlight = false;
    this.failures++;
    if (this.openedAt !== undefined || this.failures >= this.threshold) this.openedAt = this.now();
  }
}
