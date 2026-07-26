import { describe, expect, it } from 'vitest';

import type { RuleChainEntry } from '../rules/contract.js';
import {
  resolveEffectBatch,
  sortRuleChain,
  type EffectEmission,
} from './effects.js';

function emission(
  ruleId: string,
  position: number,
  effectIndex: number,
  effect: EffectEmission['effect'],
  resolvedCards?: string[],
): EffectEmission {
  return {
    ruleId,
    position,
    effectIndex,
    effect,
    ...(resolvedCards === undefined ? {} : { resolvedCards }),
  };
}

describe('effect priority and conflict resolution', () => {
  it('人気度、採用日時、ruleIdの順で一意なチェーンを作る', () => {
    const entries: RuleChainEntry[] = [
      {
        ruleId: 'r-b',
        name: 'B',
        position: 99,
        priority: {
          score: 0.5,
          activatedAt: Date.parse('2026-01-01T00:00:00.000Z'),
          ruleId: 'r-b',
        },
        bundleHash: 'b',
        contractVersion: 1,
      },
      {
        ruleId: 'r-a',
        name: 'A',
        position: 99,
        priority: {
          score: 0.5,
          activatedAt: Date.parse('2026-01-01T00:00:00.000Z'),
          ruleId: 'r-a',
        },
        bundleHash: 'a',
        contractVersion: 1,
      },
      {
        ruleId: 'r-popular',
        name: 'Popular',
        position: 99,
        priority: {
          score: 0.8,
          activatedAt: Date.parse('2026-07-01T00:00:00.000Z'),
          ruleId: 'r-popular',
        },
        bundleHash: 'popular',
        contractVersion: 1,
      },
    ];

    const sorted = sortRuleChain(entries);
    expect(sorted.map((entry) => entry.ruleId)).toEqual([
      'r-popular',
      'r-a',
      'r-b',
    ]);
    expect(sorted.map((entry) => entry.position)).toEqual([0, 1, 2]);
  });

  it('競合は最高優先を採用し、敗者のannounceを抑制する', () => {
    const batch = resolveEffectBatch('afterPlay', [
      emission('r-high', 0, 0, {
        type: 'forceRank',
        player: 'p1',
        rank: 4,
      }),
      emission('r-high', 0, 1, {
        type: 'announce',
        messageKey: 'high',
      }),
      emission('r-low', 1, 0, {
        type: 'forceRank',
        player: 'p1',
        rank: 3,
      }),
      emission('r-low', 1, 1, {
        type: 'announce',
        messageKey: 'low',
      }),
    ]);

    expect(batch.entries.map((entry) => entry.resolution)).toEqual([
      { status: 'adopted' },
      { status: 'adopted' },
      { status: 'rejected', winnerRuleId: 'r-high' },
      { status: 'suppressed-announce' },
    ]);
    expect(batch.applyOrder).toEqual([0, 1]);
  });

  it('同一効果をdedupeし、同一ルール内の後勝ちをsupersededで記録する', () => {
    const batch = resolveEffectBatch('afterPlay', [
      emission('r-high', 0, 0, {
        type: 'skipTurns',
        player: 'p2',
        count: 1,
      }),
      emission('r-low', 1, 0, {
        type: 'skipTurns',
        player: 'p2',
        count: 1,
      }),
      emission('r-memory', 2, 0, {
        type: 'setMemory',
        scope: 'game',
        key: 'mode',
        value: 'old',
      }),
      emission('r-memory', 2, 1, {
        type: 'setMemory',
        scope: 'game',
        key: 'mode',
        value: 'new',
      }),
    ]);

    expect(batch.entries.map((entry) => entry.resolution)).toEqual([
      { status: 'adopted' },
      { status: 'deduped', winnerRuleId: 'r-high' },
      { status: 'superseded' },
      { status: 'adopted' },
    ]);
    expect(batch.applyOrder).toEqual([0, 3]);
  });

  it('moveCardsの推移的なカード重複を1競合グループにする', () => {
    const batch = resolveEffectBatch('afterPlay', [
      emission(
        'r-high',
        0,
        0,
        {
          type: 'moveCards',
          from: { kind: 'hand', player: 'p1' },
          to: { kind: 'hand', player: 'p2' },
          cards: { kind: 'specific', cardIds: ['D03', 'D04'] },
        },
        ['D03', 'D04'],
      ),
      emission(
        'r-middle',
        1,
        0,
        {
          type: 'moveCards',
          from: { kind: 'hand', player: 'p2' },
          to: { kind: 'hand', player: 'p3' },
          cards: { kind: 'specific', cardIds: ['D04', 'D05'] },
        },
        ['D04', 'D05'],
      ),
      emission(
        'r-low',
        2,
        0,
        {
          type: 'moveCards',
          from: { kind: 'hand', player: 'p3' },
          to: { kind: 'discard' },
          cards: { kind: 'specific', cardIds: ['D05'] },
        },
        ['D05'],
      ),
    ]);

    expect(batch.entries.map((entry) => entry.conflictKey)).toEqual([
      'cards:D03,D04,D05',
      'cards:D03,D04,D05',
      'cards:D03,D04,D05',
    ]);
    expect(batch.entries.map((entry) => entry.resolution)).toEqual([
      { status: 'adopted' },
      { status: 'rejected', winnerRuleId: 'r-high' },
      { status: 'rejected', winnerRuleId: 'r-high' },
    ]);
  });
});
