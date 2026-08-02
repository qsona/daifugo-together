import {
  BASE_STRENGTH_ORDER,
  type Card,
  type CardRank,
  type Play,
  type RuleContext,
  type RuleModule,
  type StrengthOrder,
  type Suit,
} from '@daifugo/core';
import { describe, expect, it, vi } from 'vitest';

const { rule } = (await vi.importActual('./rule.js')) as { rule: RuleModule };

const PLAYER = 'p1';
type TestStrength = StrengthOrder & { revolution?: boolean };

function card(rank: CardRank, suit: Suit = 'spade'): Card {
  return {
    kind: 'natural',
    id: `${suit}-${rank}`,
    suit,
    rank,
  };
}

function play(ranks: CardRank[]): Play {
  return {
    kind: ranks.length === 1 ? 'single' : 'sequence',
    cards: ranks.map((rank, index) =>
      card(rank, (['spade', 'heart', 'diamond', 'club'] as const)[index % 4]),
    ),
    count: ranks.length,
    repRank: ranks[ranks.length - 1] ?? '3',
  };
}

function context({
  played,
  finished = true,
  rankingInverted = false,
  revolution = false,
}: {
  played: Play;
  finished?: boolean;
  rankingInverted?: boolean;
  revolution?: boolean;
}): RuleContext {
  const strength: TestStrength = {
    ranking: rankingInverted
      ? [...BASE_STRENGTH_ORDER.ranking].reverse()
      : [...BASE_STRENGTH_ORDER.ranking],
    revolution,
  };
  return {
    contractVersion: 1,
    game: {
      gameIndex: 0,
      activeRuleIds: ['r0004-no-finish-with-two'],
      seats: [PLAYER, 'p2', 'p3', 'p4'],
      direction: 1,
      turn: 'p2',
      players: [
        {
          id: PLAYER,
          hand: finished ? [] : [card('4')],
          status: finished ? 'finished' : 'active',
          standing: finished ? 1 : null,
        },
        { id: 'p2', hand: [], status: 'active', standing: null },
        { id: 'p3', hand: [], status: 'active', standing: null },
        { id: 'p4', hand: [], status: 'active', standing: null },
      ],
      field: {
        current: { play: played, by: PLAYER },
        passedSinceLastPlay: [],
      },
      discard: [],
      history: [],
      strength,
    },
    setHistory: [],
    memory: { game: {}, set: {} },
    rng: {
      next: () => 0.5,
      int: () => 0,
    },
  };
}

function effects(
  ranks: CardRank[],
  options: Omit<Parameters<typeof context>[0], 'played'> = {},
) {
  const played = play(ranks);
  const hook = rule.hooks.afterPlay;
  if (!hook) {
    throw new Error('afterPlay hook is required');
  }
  return hook(context({ ...options, played }), played);
}

const FOUL = {
  type: 'forceRank',
  player: PLAYER,
  rank: 'lowest',
};

describe('2あがり禁止', () => {
  it('通常時に2を含む最後の手で上がると最低順位にする', () => {
    expect(effects(['2'])).toEqual([FOUL]);
  });

  it('革命中に3を含む最後の手で上がると最低順位にする', () => {
    expect(effects(['3'], { revolution: true, rankingInverted: true })).toEqual(
      [FOUL],
    );
  });

  it('通常時の3あがりでは発動しない', () => {
    expect(effects(['3'])).toEqual([]);
  });

  it('革命中の2あがりでは発動しない', () => {
    expect(effects(['2'], { revolution: true, rankingInverted: true })).toEqual(
      [],
    );
  });

  it('ジョーカーが禁止ランクを代用しても反則あがりにしない', () => {
    const normalPlay: Play = {
      kind: 'sequence',
      cards: [card('K'), card('A'), { kind: 'joker', id: 'joker-0', index: 0 }],
      count: 3,
      repRank: '2',
    };
    const revolutionPlay: Play = {
      kind: 'sequence',
      cards: [{ kind: 'joker', id: 'joker-0', index: 0 }, card('4'), card('5')],
      count: 3,
      repRank: '5',
    };
    const hook = rule.hooks.afterPlay;
    if (!hook) {
      throw new Error('afterPlay hook is required');
    }

    expect(hook(context({ played: normalPlay }), normalPlay)).toEqual([]);
    expect(
      hook(
        context({
          played: revolutionPlay,
          revolution: true,
          rankingInverted: true,
        }),
        revolutionPlay,
      ),
    ).toEqual([]);
  });

  it('禁止対象を途中で出しても手札が残っていれば発動しない', () => {
    expect(effects(['2'], { finished: false })).toEqual([]);
    expect(
      effects(['3'], {
        finished: false,
        revolution: true,
        rankingInverted: true,
      }),
    ).toEqual([]);
  });

  it('通常時の一時反転中も禁止対象は2のまま', () => {
    expect(effects(['2'], { rankingInverted: true })).toEqual([FOUL]);
    expect(effects(['3'], { rankingInverted: true })).toEqual([]);
  });

  it('革命中の一時反転中も禁止対象は3のまま', () => {
    expect(effects(['3'], { revolution: true })).toEqual([FOUL]);
    expect(effects(['2'], { revolution: true })).toEqual([]);
  });

  it('最後の手に禁止対象と8が含まれても場流しとは独立して最低順位にする', () => {
    expect(effects(['8', '2'])).toEqual([FOUL]);
  });
});
