import { describe, expect, it } from 'vitest';

import { simulate } from './simulate.js';

describe('E1 simulation harness', () => {
  it('random-legalボットで複数セットを不変条件違反なく完走する', () => {
    const first = simulate({
      games: 5,
      seed: 'simulation-regression',
      ruleChain: [],
    });
    const second = simulate({
      games: 5,
      seed: 'simulation-regression',
      ruleChain: [],
    });

    expect(first.completed).toBe(5);
    expect(first.invariantViolations).toEqual([]);
    expect(first.failsafeActivations).toBe(0);
    expect(first.avgTurnsPerGame).toBeGreaterThan(0);
    expect(second).toEqual(first);
  });
});
