import {
  BASE_STRENGTH_ORDER,
  suitBindingFromHistory,
  type Card,
  type CardRank,
  type Play,
  type PublicGameEvent,
  type RuleContext,
  type Suit,
} from '@daifugo/core';
import { describe, expect, it } from 'vitest';

import { rule } from './rule.js';

const natural = (suit: Suit, rank: CardRank, id = `${suit}-${rank}`): Card => ({
  kind: 'natural',
  id,
  suit,
  rank,
});

const joker = (index: 0 | 1): Card => ({
  kind: 'joker',
  id: `JK${String(index)}`,
  index,
});

function play(...cards: Card[]): Play {
  const firstNatural = cards.find((card) => card.kind === 'natural');
  return {
    kind: cards.length === 1 ? 'single' : 'set',
    cards,
    count: cards.length,
    repRank: firstNatural?.rank ?? 'joker',
  };
}

const played = (value: Play, player = 'p1'): PublicGameEvent => ({
  type: 'played',
  player,
  play: value,
});

function context({
  history = [],
  current,
  resetAfter = null,
  released = false,
}: {
  history?: PublicGameEvent[];
  current?: Play;
  resetAfter?: string[] | null;
  released?: boolean;
} = {}): RuleContext {
  return {
    contractVersion: 1,
    game: {
      gameIndex: 0,
      ruleIds: [rule.meta.ruleId],
      suitBindingResetAfter: resetAfter,
      seats: ['p1', 'p2', 'p3', 'p4'],
      direction: 1,
      turn: 'p1',
      players: ['p1', 'p2', 'p3', 'p4'].map((id) => ({
        id,
        hand: [],
        status: 'active',
        standing: null,
      })),
      field: {
        ...(current ? { current: { play: current, by: 'p1' } } : {}),
        passedSinceLastPlay: [],
      },
      discard: [],
      history,
      strength: BASE_STRENGTH_ORDER,
    },
    setHistory: [],
    memory: { game: { released }, set: {} },
    rng: { next: () => 0, int: () => 0 },
  } as RuleContext;
}

const heartBinding = () => [
  played(play(natural('heart', '5', 'H05'))),
  played(play(natural('heart', '8', 'H08')), 'p2'),
];

const releaseEffects = [
  { type: 'clearSuitBinding' },
  {
    type: 'setMemory',
    scope: 'game',
    key: 'released',
    value: true,
    silent: true,
  },
];

describe('Q解き', () => {
  it('しばり中に自然なQを出すと、その手の解決後にしばりを解除する', () => {
    const queen = play(natural('heart', 'Q', 'HQ'));
    expect(
      rule.hooks.afterPlay?.(
        context({ history: heartBinding(), current: queen }),
        queen,
      ),
    ).toEqual(releaseEffects);
  });

  it('Qの合法性を変更せず、しばりに合わないQを合法化しない', () => {
    const queen = play(natural('spade', 'Q', 'SQ'));
    const illegal = { legal: false, reasonKey: 'binding' } as const;
    expect(
      rule.hooks.modifyLegality?.(
        context({ history: heartBinding(), current: queen }),
        queen,
        illegal,
      ),
    ).toEqual(illegal);
  });

  it('しばりがない状態でQを出しても状態を変更しない', () => {
    const queen = play(natural('heart', 'Q', 'HQ'));
    expect(
      rule.hooks.afterPlay?.(
        context({ history: [heartBinding()[0]!], current: queen }),
        queen,
      ),
    ).toEqual([]);
  });

  it('Qによって新しくしばりが成立する手は、既存のしばり中とは扱わない', () => {
    const queen = play(natural('heart', 'Q', 'HQ'));
    const history = [heartBinding()[0]!, played(queen, 'p2')];
    expect(
      rule.hooks.afterPlay?.(context({ history, current: queen }), queen),
    ).toEqual([]);
  });

  it('しばり中でもQを含まない手では解除しない', () => {
    const jack = play(natural('heart', 'J', 'HJ'));
    expect(
      rule.hooks.afterPlay?.(
        context({ history: heartBinding(), current: jack }),
        jack,
      ),
    ).toEqual([]);
  });

  it('ジョーカーだけでQを代用しても解除しない', () => {
    const jokerQueens: Play = {
      kind: 'set',
      cards: [joker(0), joker(1)],
      count: 2,
      repRank: 'Q',
    };
    expect(
      rule.hooks.afterPlay?.(
        context({ history: heartBinding(), current: jokerQueens }),
        jokerQueens,
      ),
    ).toEqual([]);
  });

  it('解除境界より前のしばりを無視し、後から新しいしばりを再成立させる', () => {
    const queen = play(natural('heart', 'Q', 'HQ'));
    const afterRelease = [
      ...heartBinding(),
      played(queen, 'p3'),
      played(play(natural('spade', '5', 'S05')), 'p4'),
    ];
    expect(suitBindingFromHistory(afterRelease, ['HQ'])).toBeNull();

    const rebound = [
      ...afterRelease,
      played(play(natural('spade', '8', 'S08'))),
    ];
    expect(suitBindingFromHistory(rebound, ['HQ'])).toEqual([1, 0, 0, 0]);
  });

  it('場が流れると解除・再成立追跡用の記録をリセットする', () => {
    expect(rule.hooks.afterFieldClear?.(context({ released: true }))).toEqual([
      {
        type: 'setMemory',
        scope: 'game',
        key: 'released',
        value: false,
        silent: true,
      },
    ]);
    expect(rule.hooks.afterFieldClear?.(context())).toEqual([]);
  });
});
