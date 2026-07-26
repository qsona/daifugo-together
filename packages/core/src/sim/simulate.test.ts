import { describe, expect, it } from 'vitest';

import type { RuleChainEntry, RuleModule } from '../rules/contract.js';
import { createInProcessRuleChainPort } from '../rules/in-process.js';
import { simulate, summarizeFailsafes } from './simulate.js';

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
    expect(first.turnLimitActivations).toBe(0);
    expect(first.avgTurnsPerGame).toBeGreaterThan(0);
    expect(second).toEqual(first);
  });

  it('turnLimitを通常のリード手詰まりfailsafeと分ける', () => {
    expect(
      summarizeFailsafes([
        {
          type: 'failsafe',
          reason: 'leadNoLegalMove',
          relatedRuleIds: [],
        },
        {
          type: 'failsafe',
          reason: 'turnLimit',
          relatedRuleIds: ['r1002-endless-return'],
        },
      ]),
    ).toEqual({
      total: 2,
      leadNoLegalMove: 1,
      turnLimit: 1,
    });
  });

  it('onGameStartだけで終わる初戦を発動数と平均手数へ含める', () => {
    const ruleEntry: RuleChainEntry = {
      ruleId: 'r0120-opening-finish-sim',
      name: 'opening finish simulation',
      position: 0,
      priority: {
        score: 0,
        activatedAt: Date.parse('2026-07-26T00:00:00.000Z'),
        ruleId: 'r0120-opening-finish-sim',
      },
      bundleHash: 'fixture',
      contractVersion: 1,
    };
    const module: RuleModule = {
      meta: {
        ruleId: ruleEntry.ruleId,
        name: ruleEntry.name,
        description: 'finish only the first game during onGameStart',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        onGameStart: (context) =>
          context.game.gameIndex === 0
            ? [
                { type: 'forceRank', player: 'p1', rank: 1 },
                { type: 'forceRank', player: 'p2', rank: 2 },
                { type: 'forceRank', player: 'p3', rank: 3 },
              ]
            : [],
      },
    };

    const report = simulate({
      games: 1,
      seed: 'opening-finish-simulation',
      ruleChain: [ruleEntry],
      port: createInProcessRuleChainPort([module]),
    });

    expect(report.completed).toBe(1);
    expect(report.invariantViolations).toEqual([]);
    expect(report.ruleFiredCounts).toEqual({ [ruleEntry.ruleId]: 1 });
    expect(report.avgTurnsPerGame).toBeLessThan(100);
  });
});
