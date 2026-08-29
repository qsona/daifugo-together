import {
  BASE_STRENGTH_ORDER,
  type Card,
  type Play,
  type PlayerStatus,
  type RuleContext,
} from '@daifugo/core';
import { describe, expect, it } from 'vitest';

import { rule } from './rule.js';

const actor = 'p1';
const seats = [actor, 'p2', 'p3', 'p4'];

function natural(
  rank: 'Q' | 'K',
  suit: 'spade' | 'heart' | 'diamond' | 'club' = 'spade',
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

function context(
  direction: 1 | -1 = 1,
  statuses: Record<string, PlayerStatus> = {},
): RuleContext {
  return {
    contractVersion: 1,
    game: {
      gameIndex: 0,
      ruleIds: [rule.meta.ruleId],
      seats,
      direction,
      turn: actor,
      players: seats.map((id) => ({
        id,
        hand: [],
        status: statuses[id] ?? 'active',
        standing: null,
      })),
      field: {
        current: { play: play([natural('K')]), by: actor },
        passedSinceLastPlay: [],
      },
      discard: [],
      history: [],
      strength: BASE_STRENGTH_ORDER,
    },
    setHistory: [],
    memory: { game: {}, set: {} },
    rng: { next: () => 0, int: () => 0 },
  };
}

function afterPlay(
  cards: Card[],
  direction: 1 | -1 = 1,
  statuses: Record<string, PlayerStatus> = {},
) {
  return rule.hooks.afterPlay?.(context(direction, statuses), play(cards));
}

describe('K-Skip', () => {
  it('meta.jsonと同じメタデータを公開する', () => {
    expect(rule.meta).toEqual({
      ruleId: 'r0023-k-skip',
      name: 'K-Skip',
      description:
        '自然なランクKを含む手を出すと、その手に含まれるKの枚数と同じ人数分、現在の進行方向にいる後続プレイヤーの手番を飛ばす。',
      kind: 'local',
      proposalId: '01KZ1G09RABJ4QMRPSNZYMZF9N',
      contractVersion: 1,
      messages: {},
    });
    expect(Object.keys(rule.hooks)).toEqual(['afterPlay']);
  });

  it('自然なKを1枚出すと次のプレイヤー1人を飛ばす', () => {
    expect(afterPlay([natural('K')])).toEqual([
      { type: 'skipTurns', player: 'p2', count: 1 },
    ]);
  });

  it('自然なKを2枚出すと後続する2人を飛ばす', () => {
    expect(afterPlay([natural('K'), natural('K', 'heart')])).toEqual([
      { type: 'skipTurns', player: 'p2', count: 1 },
      { type: 'skipTurns', player: 'p3', count: 1 },
    ]);
  });

  it('Kを含まない手では発動しない', () => {
    expect(afterPlay([natural('Q')])).toEqual([]);
  });

  it('ジョーカーはKの代用でも発動枚数に数えない', () => {
    expect(afterPlay([natural('K'), joker])).toEqual([
      { type: 'skipTurns', player: 'p2', count: 1 },
    ]);
    expect(afterPlay([joker])).toEqual([]);
  });

  it('手番対象外のプレイヤーを除いて次の対象を選ぶ', () => {
    expect(afterPlay([natural('K')], 1, { p2: 'finished' })).toEqual([
      { type: 'skipTurns', player: 'p3', count: 1 },
    ]);
  });

  it('参加人数以上を飛ばす場合は巡回した回数を対象ごとにまとめる', () => {
    const fourKings = [
      natural('K'),
      natural('K', 'heart'),
      natural('K', 'diamond'),
      natural('K', 'club'),
    ];
    expect(afterPlay(fourKings, 1, { p3: 'finished', p4: 'finished' })).toEqual(
      [
        { type: 'skipTurns', player: 'p2', count: 2 },
        { type: 'skipTurns', player: 'p1', count: 2 },
      ],
    );
  });

  it('進行方向が反転していれば逆向きの後続プレイヤーを飛ばす', () => {
    expect(afterPlay([natural('K'), natural('K', 'heart')], -1)).toEqual([
      { type: 'skipTurns', player: 'p4', count: 1 },
      { type: 'skipTurns', player: 'p3', count: 1 },
    ]);
  });
});
