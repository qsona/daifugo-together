import {
  BASE_STRENGTH_ORDER,
  type CardRank,
  type NaturalCard,
  type Play,
  type PlayerId,
  type RuleContext,
  type RuleModule,
  type Suit,
} from '@daifugo/core';
import { describe, expect, it, vi } from 'vitest';

const { rule } = (await vi.importActual('./rule.js')) as { rule: RuleModule };

function card(id: string, rank: CardRank, suit: Suit): NaturalCard {
  return { kind: 'natural', id, rank, suit };
}

function play(cards: NaturalCard[]): Play {
  const first = cards[0];
  if (!first) throw new Error('play requires at least one card');
  return {
    kind: cards.length === 1 ? 'single' : 'set',
    cards,
    count: cards.length,
    repRank: first.rank,
  };
}

function context(input: {
  actor?: PlayerId;
  played: Play;
  remaining?: NaturalCard[];
}): RuleContext {
  const actor = input.actor ?? 'p1';
  const remaining = input.remaining ?? [];
  return {
    contractVersion: 1,
    game: {
      gameIndex: 0,
      activeRuleIds: ['r0001-eight-cut'],
      seats: ['p1', 'p2', 'p3', 'p4'],
      direction: 1,
      turn: actor,
      players: ['p1', 'p2', 'p3', 'p4'].map((id) => ({
        id,
        hand: id === actor ? remaining : [card(`${id}-3`, '3', 'diamond')],
        status:
          id === actor && remaining.length === 0
            ? ('finished' as const)
            : ('active' as const),
        standing: id === actor && remaining.length === 0 ? 1 : null,
      })),
      field: {
        current: { play: input.played, by: actor },
        passedSinceLastPlay: [],
      },
      discard: [],
      history: [{ type: 'played', player: actor, play: input.played }],
      strength: BASE_STRENGTH_ORDER,
    },
    setHistory: [],
    memory: { game: {}, set: {} },
    rng: {
      next: () => 0.5,
      int: () => 0,
    },
  };
}

describe('8切り', () => {
  it('8を出して手札が残ると場だけを流す', () => {
    const played = play([card('S08', '8', 'spade')]);
    const result = rule.hooks.afterPlay?.(
      context({
        played,
        remaining: [card('H09', '9', 'heart')],
      }),
      played,
    );

    expect(result).toEqual([{ type: 'clearField' }]);
  });

  it('ジョーカーが8を代用しても発動しない (自然カードの8のみが対象)', () => {
    const played: Play = {
      kind: 'sequence',
      cards: [
        card('S06', '6', 'spade'),
        card('S07', '7', 'spade'),
        { kind: 'joker', id: 'JK0', index: 0 },
      ],
      count: 3,
      repRank: '8',
    };

    expect(
      rule.hooks.afterPlay?.(
        context({ played, remaining: [card('H10', '10', 'heart')] }),
        played,
      ),
    ).toEqual([]);
  });

  it('8を含まない手では何も起こさない', () => {
    const played = play([card('S07', '7', 'spade')]);

    expect(rule.hooks.afterPlay?.(context({ played }), played)).toEqual([]);
  });

  it('8で手札を使い切ると場を流して最低順位へ固定する', () => {
    const played = play([card('S08', '8', 'spade')]);

    expect(rule.hooks.afterPlay?.(context({ played }), played)).toEqual([
      { type: 'clearField' },
      { type: 'forceRank', player: 'p1', rank: 'lowest' },
    ]);
  });

  it('複数枚の合法な組に8が含まれる場合も発動する', () => {
    const played = play([card('S08', '8', 'spade'), card('H08', '8', 'heart')]);

    expect(
      rule.hooks.afterPlay?.(
        context({
          played,
          remaining: [card('C10', '10', 'club')],
        }),
        played,
      ),
    ).toEqual([{ type: 'clearField' }]);
  });

  it('複数の反則あがりでも発生順に各プレイヤーの最低順位を要求する', () => {
    const firstPlay = play([card('S08', '8', 'spade')]);
    const secondPlay = play([card('H08', '8', 'heart')]);

    const first = rule.hooks.afterPlay?.(
      context({ actor: 'p1', played: firstPlay }),
      firstPlay,
    );
    const second = rule.hooks.afterPlay?.(
      context({ actor: 'p2', played: secondPlay }),
      secondPlay,
    );

    expect([first?.[1], second?.[1]]).toEqual([
      { type: 'forceRank', player: 'p1', rank: 'lowest' },
      { type: 'forceRank', player: 'p2', rank: 'lowest' },
    ]);
  });
});
