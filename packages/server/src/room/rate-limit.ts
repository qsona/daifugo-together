export interface FixedWindowRateLimitOptions {
  maxAttempts: number;
  windowMs: number;
}

interface Window {
  startedAt: number;
  attempts: number;
}

export class FixedWindowRateLimiter {
  readonly #maxAttempts: number;
  readonly #windowMs: number;
  readonly #windows = new Map<string, Window>();

  constructor(options: FixedWindowRateLimitOptions) {
    if (
      !Number.isSafeInteger(options.maxAttempts) ||
      options.maxAttempts < 1 ||
      !Number.isFinite(options.windowMs) ||
      options.windowMs <= 0
    ) {
      throw new Error('Invalid fixed-window rate limit');
    }
    this.#maxAttempts = options.maxAttempts;
    this.#windowMs = options.windowMs;
  }

  allow(key: string, now: number): boolean {
    const existing = this.#windows.get(key);
    if (!existing || now - existing.startedAt >= this.#windowMs) {
      this.#windows.set(key, { startedAt: now, attempts: 1 });
      return true;
    }
    if (existing.attempts >= this.#maxAttempts) return false;
    existing.attempts += 1;
    return true;
  }
}
