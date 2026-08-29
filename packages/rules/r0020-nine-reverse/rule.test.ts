import type { Card, Play, RuleContext } from '@daifugo/core';
import { describe, expect, it } from 'vitest';

import { rule } from './rule.js';

const player = 'p1';

function natural(
  rank: '8' | '9' | '10',
  suit: 'spade' | 'heart' = 'spade',
): Card {
  return { kind: 'natural', id: `${suit}-${rank}`, suit, rank };
}

const joker: Card = { kind: 'joker', id: 'JK0', index: 0 };

function play(cards: Card[]): Play {
  const first = cards[0];
  return {
    kind: cards.length === 1 ? 'single' : 'set',
    cards,
    count: cards.length,
    repRank: first?.kind === 'natural' ? first.rank : 'joker',
  };
}

function context(hand: Card[] = []): RuleContext {
  return {
    contractVersion: 1,
    game: {
      gameIndex: 0,
      ruleIds: [rule.meta.ruleId],
      seats: [player, 'p2', 'p3', 'p4'],
      direction: 1,
      turn: player,
      players: [
        { id: player, hand, status: 'active', standing: null },
        { id: 'p2', hand: [], status: 'active', standing: null },
        { id: 'p3', hand: [], status: 'active', standing: null },
        { id: 'p4', hand: [], status: 'active', standing: null },
      ],
      field: { passedSinceLastPlay: [] },
      discard: [],
      history: [],
      strength: {
        ranking: [
          '3',
          '4',
          '5',
          '6',
          '7',
          '8',
          '9',
          '10',
          'J',
          'Q',
          'K',
          'A',
          '2',
        ],
      },
    },
    setHistory: [],
    memory: { game: {}, set: {} },
    rng: { next: () => 0, int: () => 0 },
  };
}

function afterPlay(cards: Card[], remainingHand: Card[] = []) {
  return rule.hooks.afterPlay?.(context(remainingHand), play(cards));
}

describe('9-リバース', () => {
  it('meta.jsonと同じメタデータを公開する', () => {
    expect(rule.meta).toEqual({
      ruleId: 'r0020-nine-reverse',
      name: '9-リバース',
      description:
        '自然なランク9を含む手を出すと、現在の進行方向を1回反転する。同じ手に9が複数含まれていても、反転回数は増えない。',
      kind: 'local',
      prefecture: '東京都',
      proposalId: '01KZ1FMS68BBPNVWX9G4CZG5JH',
      contractVersion: 1,
      messages: {},
    });
    expect(Object.keys(rule.hooks)).toEqual(['afterPlay']);
  });

  it('自然な9を1枚出すと進行方向を1回反転する', () => {
    expect(afterPlay([natural('9')])).toEqual([{ type: 'reverseTurnOrder' }]);
  });

  it('自然な9を複数枚出してもEffectは1件だけ返す', () => {
    expect(afterPlay([natural('9'), natural('9', 'heart')])).toEqual([
      { type: 'reverseTurnOrder' },
    ]);
  });

  it('自然な9を含まない手やジョーカーによる代用では発動しない', () => {
    expect(afterPlay([natural('8')])).toEqual([]);
    expect(afterPlay([joker])).toEqual([]);
    expect(afterPlay([natural('8'), joker])).toEqual([]);
  });

  it('別々のプレイなら各プレイで1回ずつ反転する', () => {
    expect(afterPlay([natural('9')])).toEqual([{ type: 'reverseTurnOrder' }]);
    expect(afterPlay([natural('9', 'heart')])).toEqual([
      { type: 'reverseTurnOrder' },
    ]);
  });

  it('9を含む手で上がった後も反転Effectを1件だけ返す', () => {
    expect(afterPlay([natural('9')], [])).toEqual([
      { type: 'reverseTurnOrder' },
    ]);
  });
});
