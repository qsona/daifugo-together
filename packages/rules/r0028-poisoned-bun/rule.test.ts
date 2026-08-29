import type {
  Card,
  CardRank,
  Play,
  RuleContext,
  StrengthOrder,
  Suit,
} from '@daifugo/core';
import { BASE_STRENGTH_ORDER, CARD_RANKS } from '@daifugo/core';
import { describe, expect, it } from 'vitest';

import { rule } from './rule.js';

const natural = (suit: Suit, rank: CardRank, id = `${suit}-${rank}`): Card => ({
  kind: 'natural',
  id,
  suit,
  rank,
});

const joker = (index: 0 | 1 = 0): Card => ({
  kind: 'joker',
  id: `JK${String(index)}`,
  index,
});

function play(...cards: Card[]): Play {
  return {
    kind: cards.length === 1 ? 'single' : 'set',
    cards,
    count: cards.length,
    repRank: cards[0]?.kind === 'joker' ? 'joker' : (cards[0]?.rank ?? '3'),
  };
}

interface ContextOptions {
  actor?: string;
  daifugoHand?: Card[];
  previousPlay?: Play;
  fieldClearedAfterPreviousPlay?: boolean;
  previousGame?: boolean;
  strength?: StrengthOrder;
}

function context(
  currentPlay: Play,
  {
    actor = 'p4',
    daifugoHand = [natural('heart', '2', 'H02')],
    previousPlay,
    fieldClearedAfterPreviousPlay = false,
    previousGame = true,
    strength = { ...BASE_STRENGTH_ORDER },
  }: ContextOptions = {},
): RuleContext {
  return {
    contractVersion: 1,
    game: {
      gameIndex: previousGame ? 1 : 0,
      ruleIds: [rule.meta.ruleId],
      seats: ['p1', 'p2', 'p3', 'p4'],
      direction: 1,
      turn: 'p1',
      players: [
        { id: 'p1', hand: daifugoHand, status: 'active', standing: null },
        { id: 'p2', hand: [], status: 'active', standing: null },
        { id: 'p3', hand: [], status: 'active', standing: null },
        { id: 'p4', hand: [], status: 'active', standing: null },
      ],
      field: {
        current: { play: currentPlay, by: actor },
        passedSinceLastPlay: [],
      },
      discard: [],
      history: [
        ...(previousPlay
          ? [
              { type: 'played' as const, player: 'p1', play: previousPlay },
              ...(fieldClearedAfterPreviousPlay
                ? [
                    {
                      type: 'fieldCleared' as const,
                      reason: 'allPassed' as const,
                      nextLeader: actor,
                    },
                  ]
                : []),
            ]
          : []),
      ],
      strength,
    },
    setHistory: previousGame
      ? [
          {
            gameIndex: 0,
            standings: [
              { player: 'p1', standing: 1, title: '大富豪' },
              { player: 'p2', standing: 2, title: '富豪' },
              { player: 'p3', standing: 3, title: '貧民' },
              { player: 'p4', standing: 4, title: '大貧民' },
            ],
            firedRuleIds: [],
          },
        ]
      : [],
    memory: { game: {}, set: {} },
    rng: { next: () => 0, int: () => 0 },
  } as RuleContext;
}

const expectedEffects = (cardId: string) => [
  {
    type: 'moveCards',
    from: { kind: 'hand', player: 'p1' },
    to: { kind: 'discard' },
    cards: { kind: 'specific', cardIds: [cardId] },
  },
  { type: 'announce', messageKey: 'activated' },
];

describe('毒まんじゅう', () => {
  it('大貧民がスペード3を出すと自動で大富豪の最強札を捨ててカットインを出す', () => {
    const spadeThree = play(natural('spade', '3', 'S03'));

    expect(
      rule.hooks.afterPlay?.(
        context(spadeThree, {
          daifugoHand: [
            natural('club', '8', 'C08'),
            natural('heart', '2', 'H02'),
            natural('spade', 'A', 'SA'),
          ],
        }),
        spadeThree,
      ),
    ).toEqual(expectedEffects('H02'));
  });

  it('同じ最強ランクが複数あるとカードID順で1枚だけ選ぶ', () => {
    const spadeThree = play(natural('spade', '3', 'S03'));

    expect(
      rule.hooks.afterPlay?.(
        context(spadeThree, {
          daifugoHand: [
            natural('heart', '2', 'H02'),
            natural('club', '2', 'C02'),
            natural('spade', '2', 'S02'),
          ],
        }),
        spadeThree,
      ),
    ).toEqual(expectedEffects('C02'));
  });

  it('複数枚の手にスペード3を含んでいても発動する', () => {
    const withSpadeThree = play(
      natural('spade', '3', 'S03'),
      natural('heart', '3', 'H03'),
    );

    expect(
      rule.hooks.afterPlay?.(context(withSpadeThree), withSpadeThree),
    ).toEqual(expectedEffects('H02'));
  });

  it('大貧民以外がスペード3を出しても発動しない', () => {
    const spadeThree = play(natural('spade', '3', 'S03'));

    expect(
      rule.hooks.afterPlay?.(context(spadeThree, { actor: 'p3' }), spadeThree),
    ).toEqual([]);
  });

  it('スペード3を含まない手では発動しない', () => {
    const heartThree = play(natural('heart', '3', 'H03'));

    expect(rule.hooks.afterPlay?.(context(heartThree), heartThree)).toEqual([]);
  });

  it('単体ジョーカーへのスペ3返しでは発動しない', () => {
    const spadeThree = play(natural('spade', '3', 'S03'));

    expect(
      rule.hooks.afterPlay?.(
        context(spadeThree, { previousPlay: play(joker()) }),
        spadeThree,
      ),
    ).toEqual([]);
  });

  it('以前のジョーカー場が流れた後なら通常どおり発動する', () => {
    const spadeThree = play(natural('spade', '3', 'S03'));

    expect(
      rule.hooks.afterPlay?.(
        context(spadeThree, {
          previousPlay: play(joker()),
          fieldClearedAfterPreviousPlay: true,
        }),
        spadeThree,
      ),
    ).toEqual(expectedEffects('H02'));
  });

  it('第1ゲームでは発動しない', () => {
    const spadeThree = play(natural('spade', '3', 'S03'));

    expect(
      rule.hooks.afterPlay?.(
        context(spadeThree, { previousGame: false }),
        spadeThree,
      ),
    ).toEqual([]);
  });

  it('大富豪の手札が空なら発動しない', () => {
    const spadeThree = play(natural('spade', '3', 'S03'));

    expect(
      rule.hooks.afterPlay?.(
        context(spadeThree, { daifugoHand: [] }),
        spadeThree,
      ),
    ).toEqual([]);
  });

  it('革命や一時反転を含む実効強さ順で最強札を決める', () => {
    const spadeThree = play(natural('spade', '3', 'S03'));
    const reversed: StrengthOrder = {
      ranking: [...CARD_RANKS].reverse(),
      revolution: true,
    };

    expect(
      rule.hooks.afterPlay?.(
        context(spadeThree, {
          daifugoHand: [
            natural('heart', '2', 'H02'),
            natural('club', '3', 'C03'),
            natural('spade', 'A', 'SA'),
          ],
          strength: reversed,
        }),
        spadeThree,
      ),
    ).toEqual(expectedEffects('C03'));
  });

  it('ジョーカーが有効な構成ではジョーカーを最強札として選ぶ', () => {
    const spadeThree = play(natural('spade', '3', 'S03'));

    expect(
      rule.hooks.afterPlay?.(
        context(spadeThree, {
          daifugoHand: [natural('heart', '2', 'H02'), joker(1)],
        }),
        spadeThree,
      ),
    ).toEqual(expectedEffects('JK1'));
  });
});
