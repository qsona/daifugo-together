import {
  BASE_STRENGTH_ORDER,
  type Card,
  type Play,
  type RuleContext,
} from '@daifugo/core';
import { describe, expect, it } from 'vitest';

import { rule } from './rule.js';

const actor = 'p1';

function natural(
  rank: '3' | '4' | '5' | '7' | '9' | '10' | 'K',
  suit: 'spade' | 'heart' = 'spade',
): Card {
  return { kind: 'natural', id: `${suit}-${rank}`, suit, rank };
}

function play(cards: Card[]): Play {
  const first = cards[0];
  return {
    kind: cards.length === 1 ? 'single' : 'set',
    cards,
    count: cards.length,
    repRank: first?.kind === 'natural' ? first.rank : 'joker',
  };
}

function context(hand: Card[]): RuleContext {
  return {
    contractVersion: 1,
    game: {
      gameIndex: 0,
      seats: [actor, 'p2', 'p3', 'p4'],
      direction: 1,
      turn: 'p2',
      players: [
        {
          id: actor,
          hand,
          status: hand.length === 0 ? 'finished' : 'active',
          standing: hand.length === 0 ? 1 : null,
        },
        { id: 'p2', hand: [], status: 'active', standing: null },
        { id: 'p3', hand: [], status: 'active', standing: null },
        { id: 'p4', hand: [], status: 'active', standing: null },
      ],
      field: {
        current: { play: play([natural('9')]), by: actor },
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

function afterPlay(playedCards: Card[], hand: Card[]) {
  return rule.hooks.afterPlay?.(context(hand), play(playedCards));
}

const announcement = [{ type: 'announce', messageKey: 'uno_announce' }];

describe('ウノ', () => {
  it('meta.jsonと同じメタデータを公開する', () => {
    expect(rule.meta).toEqual({
      ruleId: 'r0024-uno',
      name: 'ウノ',
      description:
        '手を出した後、残り手札のすべてが単体、同一ランクの組、または階段として次の1回でまとめて出せる形であり、そのプレイから7渡しや10捨てなどの追加のカード選択・移動が発生しない場合、自動的に「ウノ！」と宣言する。',
      kind: 'local',
      prefecture: '東京都',
      proposalId: '01KZ1G5GKJPHV960J7CM65SAPY',
      contractVersion: 1,
      engineFeatures: ['sequence'],
      messages: { uno_announce: 'ウノ！' },
    });
    expect(Object.keys(rule.hooks)).toEqual(['afterPlay']);
  });

  it('残り手札が1枚ならウノを通知する', () => {
    expect(afterPlay([natural('9')], [natural('K')])).toEqual(announcement);
  });

  it('残り手札のすべてが同一ランクの組なら通知する', () => {
    expect(
      afterPlay([natural('9')], [natural('K'), natural('K', 'heart')]),
    ).toEqual(announcement);
  });

  it('残り手札のすべてが同一スートの階段なら通知する', () => {
    expect(
      afterPlay([natural('9')], [natural('3'), natural('4'), natural('5')]),
    ).toEqual(announcement);
  });

  it('残り手札を1回の手型にまとめられない場合は通知しない', () => {
    expect(afterPlay([natural('9')], [natural('3'), natural('5')])).toEqual([]);
  });

  it('7渡しまたは10捨てを発動するプレイでは通知しない', () => {
    expect(afterPlay([natural('7')], [natural('K')])).toEqual([]);
    expect(afterPlay([natural('10')], [natural('K')])).toEqual([]);
  });

  it('プレイによって手札が0枚になった場合は通知しない', () => {
    expect(afterPlay([natural('9')], [])).toEqual([]);
  });
});
