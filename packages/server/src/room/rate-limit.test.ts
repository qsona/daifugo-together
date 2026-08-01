import { describe, expect, it } from 'vitest';

import { FixedWindowRateLimiter } from './rate-limit.js';

describe('FixedWindowRateLimiter', () => {
  it('keyごとに上限を適用し、window経過でリセットする', () => {
    const limiter = new FixedWindowRateLimiter({
      maxAttempts: 2,
      windowMs: 60_000,
    });
    expect(limiter.allow('ip-a', 1_000)).toBe(true);
    expect(limiter.allow('ip-a', 1_001)).toBe(true);
    expect(limiter.allow('ip-a', 1_002)).toBe(false);
    expect(limiter.allow('ip-b', 1_002)).toBe(true);
    expect(limiter.allow('ip-a', 61_000)).toBe(true);
  });

  it('期限切れwindowを定期的に掃除してkeyを再利用できる', () => {
    const limiter = new FixedWindowRateLimiter({
      maxAttempts: 1,
      windowMs: 100,
    });
    expect(limiter.allow('old-ip', 0)).toBe(true);

    for (let index = 0; index < 63; index += 1) {
      expect(limiter.allow(`new-ip-${String(index)}`, 100)).toBe(true);
    }

    expect(limiter.allow('old-ip', 100)).toBe(true);
    expect(limiter.allow('old-ip', 101)).toBe(false);
  });
});
