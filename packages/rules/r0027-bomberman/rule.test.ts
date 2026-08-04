import type { Card, Play, RuleContext } from '@daifugo/core';
import { describe, expect, it } from 'vitest';

import { rule } from './rule.js';

const natural = (id: string, rank: '3' | '4' | '5' | '6' | '7'): Card => ({
  kind: 'natural',
  id,
  suit: 'spade',
  rank,
});

const hand = [
  natural('H1', '3'),
  natural('H2', '4'),
  natural('H3', '5'),
  natural('H4', '6'),
];

function sequence(count = 3): Play {
  return {
    kind: 'sequence',
    cards: hand.slice(0, count),
    count,
    repRank: '5',
  };
}

function context(playerHand: readonly Card[] = hand): RuleContext {
  return {
    contractVersion: 2,
    game: {
      gameIndex: 0,
      seats: ['p1', 'p2', 'p3', 'p4'],
      direction: 1,
      turn: 'p2',
      players: [
        {
          id: 'p1',
          hand: playerHand,
          status: playerHand.length === 0 ? 'finished' : 'active',
          standing: playerHand.length === 0 ? 1 : null,
        },
        { id: 'p2', hand: [], status: 'active', standing: null },
        { id: 'p3', hand: [], status: 'active', standing: null },
        { id: 'p4', hand: [], status: 'active', standing: null },
      ],
      field: {
        current: { play: sequence(), by: 'p1' },
        passedSinceLastPlay: [],
      },
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
    rng: { next: () => 0.5, int: () => 0 },
  };
}

describe('ボンバーマン', () => {
  it('3枚の階段で出した本人の残り手札から正確に3枚を選ばせる', () => {
    expect(rule.hooks.afterPlay?.(context(), sequence())).toEqual([
      {
        type: 'requestChoice',
        player: 'p1',
        choiceId: 'bomberman_discard',
        from: { kind: 'hand', player: 'p1' },
        cards: { kind: 'all' },
        count: 3,
        messageKey: 'bomberman_select_cards',
      },
    ]);
  });

  it('選択したカードを本人の手札から捨て札へ移す', () => {
    expect(
      rule.hooks.afterPlay?.(context(), sequence(), {
        kind: 'cards',
        choiceId: 'bomberman_discard',
        cardIds: ['H2', 'H4', 'H1'],
      }),
    ).toEqual([
      {
        type: 'moveCards',
        from: { kind: 'hand', player: 'p1' },
        to: { kind: 'discard' },
        cards: { kind: 'specific', cardIds: ['H2', 'H4', 'H1'] },
      },
    ]);
  });

  it('5枚の階段で残り手札が2枚なら正確に2枚を選ばせる', () => {
    expect(
      rule.hooks.afterPlay?.(context(hand.slice(0, 2)), sequence(5)),
    ).toEqual([expect.objectContaining({ type: 'requestChoice', count: 2 })]);
  });

  it.each(['single', 'set'] as const)(
    '%sは階段ではないので発動しない',
    (kind) => {
      expect(
        rule.hooks.afterPlay?.(context(), {
          kind,
          cards: kind === 'single' ? [hand[0]!] : hand.slice(0, 2),
          count: kind === 'single' ? 1 : 2,
          repRank: '3',
        }),
      ).toEqual([]);
    },
  );

  it('階段であっても残り手札が0枚なら選択を要求しない', () => {
    expect(rule.hooks.afterPlay?.(context([]), sequence())).toEqual([]);
  });

  it('階段でないカードの並びは発動対象にしない', () => {
    expect(
      rule.hooks.afterPlay?.(context(), {
        kind: 'set',
        cards: [hand[0]!, hand[2]!, hand[3]!],
        count: 3,
        repRank: '3',
      }),
    ).toEqual([]);
  });
});
