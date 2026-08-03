import type { Card, Play, RuleContext } from '@daifugo/core';
import { BASE_STRENGTH_ORDER } from '@daifugo/core';
import { describe, expect, it } from 'vitest';

import { rule } from './rule.js';

const four: Card = {
  kind: 'natural',
  id: 'S04',
  suit: 'spade',
  rank: '4',
};
const trigger: Play = { kind: 'single', cards: [four], count: 1, repRank: '4' };

function context(hands: Record<string, Card[]> = {}): RuleContext {
  return {
    contractVersion: 2,
    game: {
      gameIndex: 0,
      seats: ['p1', 'p2', 'p3', 'p4'],
      direction: 1,
      turn: 'p2',
      players: ['p1', 'p2', 'p3', 'p4'].map((id) => ({
        id,
        hand: hands[id] ?? [
          { kind: 'natural', id: `${id}-5`, suit: 'heart', rank: '5' },
        ],
        status: 'active' as const,
        standing: null,
      })),
      field: { current: { play: trigger, by: 'p1' }, passedSinceLastPlay: [] },
      discard: [],
      history: [],
      strength: BASE_STRENGTH_ORDER,
    },
    setHistory: [],
    memory: { game: {}, set: {} },
    rng: { next: () => 0.5, int: () => 42 },
  } as RuleContext;
}

describe('リアルボンバー', () => {
  it('自然な4のsingleで独立ミニゲームを要求する', () => {
    expect(rule.hooks.afterPlay?.(context(), trigger)).toEqual([
      {
        type: 'requestChoice',
        kind: 'miniGame',
        player: 'p1',
        choiceId: 'real_bomber_bomb_throw',
        miniGame: 'bomb_throw_15',
        participants: ['p1', 'p2', 'p3', 'p4'],
        durationMs: 12_000,
        seed: '16',
        messageKey: 'real_bomber_start',
      },
    ]);
  });

  it('set、別ランク、ジョーカーでは発動しない', () => {
    const other: Play = {
      kind: 'single',
      cards: [{ kind: 'natural', id: 'S05', suit: 'spade', rank: '5' }],
      count: 1,
      repRank: '5',
    };
    const set: Play = {
      kind: 'set',
      cards: [four, { ...four, id: 'H04', suit: 'heart' }],
      count: 2,
      repRank: '4',
    };
    const joker: Play = {
      kind: 'single',
      cards: [{ kind: 'joker', id: 'JK0', index: 0 }],
      count: 1,
      repRank: 'joker',
    };
    expect(rule.hooks.afterPlay?.(context(), other)).toEqual([]);
    expect(rule.hooks.afterPlay?.(context(), set)).toEqual([]);
    expect(rule.hooks.afterPlay?.(context(), joker)).toEqual([]);
  });

  it('ミニゲームの勝者IDだけを受け、勝者に最大2枚を選ばせる', () => {
    const effects = rule.hooks.afterPlay?.(
      context({
        p3: [
          { kind: 'natural', id: 'C06', suit: 'club', rank: '6' },
          { kind: 'natural', id: 'D07', suit: 'diamond', rank: '7' },
          { kind: 'natural', id: 'S08', suit: 'spade', rank: '8' },
        ],
      }),
      trigger,
      {
        kind: 'miniGameResult',
        choiceId: 'real_bomber_bomb_throw',
        miniGameId: 'runtime-owned',
        winnerPlayerId: 'p3',
        scores: { p3: { score: 2, hitsTaken: 0 } },
      },
    );
    expect(effects).toEqual([
      {
        type: 'requestChoice',
        player: 'p3',
        choiceId: 'real_bomber_discard_s2',
        from: { kind: 'hand', player: 'p3' },
        cards: { kind: 'all' },
        count: 2,
        messageKey: 'real_bomber_discard',
      },
    ]);
  });

  it('選んだカードを捨て、勝者を通知する', () => {
    expect(
      rule.hooks.afterPlay?.(context(), trigger, {
        kind: 'cards',
        choiceId: 'real_bomber_discard_s1',
        cardIds: ['p2-5'],
      }),
    ).toEqual([
      {
        type: 'moveCards',
        from: { kind: 'hand', player: 'p2' },
        to: { kind: 'discard' },
        cards: { kind: 'specific', cardIds: ['p2-5'] },
      },
      {
        type: 'announce',
        messageKey: 'real_bomber_result',
        params: { winner: 'プレイヤー2' },
      },
    ]);
  });
});
