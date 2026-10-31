// Fixed-window request limits, kept in memory per server instance. Used for calls that cost
// money or reach third-party providers (speech, image analysis) and for passkey ceremonies.
import { HttpError } from './http';

export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly message = 'Too many requests. Wait a minute and try again.',
  ) {}

  /** Counts one request for `key`; throws 429 once the window's allowance is used up. */
  take(key: string, now: number): void {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      if (this.hits.size > 10000) this.hits.clear();
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return;
    }
    if (entry.count >= this.max) throw new HttpError(429, 'RATE_LIMITED', this.message);
    entry.count++;
  }
}
