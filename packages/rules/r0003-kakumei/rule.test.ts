import {
  BASE_STRENGTH_ORDER,
  rankPosition,
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
const SUITS: Suit[] = ['spade', 'heart', 'diamond', 'club'];
type TestStrength = StrengthOrder & { revolution?: boolean };
const NORMAL_STRENGTH: TestStrength = {
  ranking: [...BASE_STRENGTH_ORDER.ranking],
  revolution: false,
};
const REVOLUTION_STRENGTH: TestStrength = {
  ranking: [...BASE_STRENGTH_ORDER.ranking].reverse(),
  revolution: true,
};

function natural(rank: CardRank, suit: Suit, suffix = ''): Card {
  return {
    kind: 'natural',
    id: `${suit}-${rank}${suffix}`,
    suit,
    rank,
  };
}

function setPlay(rank: CardRank, count: number): Play {
  const cards: Card[] = SUITS.map((suit) => natural(rank, suit));
  if (count >= 5) {
    cards.push({ kind: 'joker', id: 'joker-0', index: 0 });
  }
  if (count >= 6) {
    cards.push({ kind: 'joker', id: 'joker-1', index: 1 });
  }
  return {
    kind: 'set',
    cards: cards.slice(0, count),
    count,
    repRank: rank,
  };
}

function sequencePlay(): Play {
  return {
    kind: 'sequence',
    cards: [
      natural('3', 'spade'),
      natural('4', 'spade'),
      natural('5', 'spade'),
      natural('6', 'spade'),
    ],
    count: 4,
    repRank: '6',
  };
}

function context({
  active,
  strength = active ? REVOLUTION_STRENGTH : NORMAL_STRENGTH,
  play,
  finished = false,
  fieldPresent = true,
}: {
  active?: boolean;
  strength?: TestStrength;
  play?: Play;
  finished?: boolean;
  fieldPresent?: boolean;
} = {}): RuleContext {
  return {
    contractVersion: 1,
    game: {
      gameIndex: 0,
      ruleIds: [rule.meta.ruleId],
      seats: [PLAYER, 'p2', 'p3', 'p4'],
      direction: 1,
      turn: 'p2',
      players: [
        {
          id: PLAYER,
          hand: [],
          status: finished ? 'finished' : 'active',
          standing: finished ? 1 : null,
        },
        { id: 'p2', hand: [], status: 'active', standing: null },
        { id: 'p3', hand: [], status: 'active', standing: null },
        { id: 'p4', hand: [], status: 'active', standing: null },
      ],
      field:
        fieldPresent && play
          ? { current: { play, by: PLAYER }, passedSinceLastPlay: [] }
          : { passedSinceLastPlay: [] },
      discard: [],
      history: [],
      strength,
    },
    setHistory: [],
    memory: {
      game: active === undefined ? {} : { active },
      set: {},
    },
    rng: {
      next: () => 0.5,
      int: () => 0,
    },
  };
}

function afterPlay(play: Play, options: Parameters<typeof context>[0] = {}) {
  const hook = rule.hooks.afterPlay;
  if (!hook) {
    throw new Error('afterPlay hook is required');
  }
  return hook(context({ ...options, play }), play);
}

function modifyStrength(
  options: Parameters<typeof context>[0],
): Readonly<TestStrength> {
  const hook = rule.hooks.modifyStrength;
  if (!hook) {
    throw new Error('modifyStrength hook is required');
  }
  const strength = hook(
    context(options),
    NORMAL_STRENGTH,
  ) as Readonly<TestStrength>;
  return {
    ranking: [...strength.ranking],
    ...(strength.revolution === undefined
      ? {}
      : { revolution: strength.revolution }),
  };
}

describe('革命', () => {
  it('ゲーム開始時は初期化イベントを出さず通常の強さ順を保つ', () => {
    expect(rule.hooks.onGameStart).toBeUndefined();
    expect(modifyStrength({}).ranking).toEqual(BASE_STRENGTH_ORDER.ranking);
  });

  it('同一ランクの4枚組で革命になり、3が最強、2が最弱になる', () => {
    const play = setPlay('7', 4);

    expect(afterPlay(play, { active: false })).toContainEqual({
      type: 'setMemory',
      scope: 'game',
      key: 'active',
      value: true,
    });

    const strength = modifyStrength({ active: true });
    expect(strength.revolution).toBe(true);
    expect(rankPosition('3', strength)).toBe(strength.ranking.length - 1);
    expect(rankPosition('2', strength)).toBe(0);
  });

  it('同一ランクとして成立する5枚組でも革命状態を切り替える', () => {
    expect(afterPlay(setPlay('9', 5), { active: false })).toContainEqual({
      type: 'setMemory',
      scope: 'game',
      key: 'active',
      value: true,
    });
  });

  it('4枚以上の階段では革命が発動しない', () => {
    expect(afterPlay(sequencePlay(), { active: false })).toEqual([]);
  });

  it('3枚以下の同一ランク組では革命が発動しない', () => {
    expect(afterPlay(setPlay('Q', 3), { active: false })).toEqual([]);
  });

  it('革命中もジョーカーを最強として扱う', () => {
    const strength = modifyStrength({ active: true });

    expect(rankPosition('joker', strength)).toBe(strength.ranking.length);
    expect(rankPosition('joker', strength)).toBeGreaterThan(
      rankPosition('3', strength),
    );
  });

  it('革命中の4枚組で革命返しとなり通常の強さ順へ戻る', () => {
    expect(afterPlay(setPlay('K', 4), { active: true })).toContainEqual({
      type: 'setMemory',
      scope: 'game',
      key: 'active',
      value: false,
    });
    expect(modifyStrength({ active: false }).ranking).toEqual(
      BASE_STRENGTH_ORDER.ranking,
    );
  });

  it('場が流れても革命状態を維持する', () => {
    expect(
      modifyStrength({ active: true, fieldPresent: false }).ranking,
    ).toEqual(REVOLUTION_STRENGTH.ranking);
  });

  it('プレイ直前から革命中で、最後の手に3を含むと最低順位にする', () => {
    expect(
      afterPlay(
        {
          kind: 'single',
          cards: [natural('3', 'spade')],
          count: 1,
          repRank: '3',
        },
        { active: true, finished: true },
      ),
    ).toContainEqual({
      type: 'forceRank',
      player: PLAYER,
      rank: 'lowest',
    });
  });

  it('革命中にジョーカーが3を代用して上がっても反則あがりにしない', () => {
    const played: Play = {
      kind: 'sequence',
      cards: [
        { kind: 'joker', id: 'joker-0', index: 0 },
        natural('4', 'spade'),
        natural('5', 'spade'),
      ],
      count: 3,
      repRank: '5',
    };

    expect(
      afterPlay(played, {
        active: true,
        strength: REVOLUTION_STRENGTH,
        finished: true,
      }),
    ).toEqual([]);
  });

  it('革命中でも最後の手が2だけなら反則あがりにしない', () => {
    expect(
      afterPlay(
        {
          kind: 'single',
          cards: [natural('2', 'spade')],
          count: 1,
          repRank: '2',
        },
        { active: true, finished: true },
      ),
    ).not.toContainEqual({
      type: 'forceRank',
      player: PLAYER,
      rank: 'lowest',
    });
  });

  it('ランキングだけが一時反転していても革命中とは扱わない', () => {
    expect(
      afterPlay(
        {
          kind: 'single',
          cards: [natural('3', 'spade')],
          count: 1,
          repRank: '3',
        },
        {
          active: false,
          strength: {
            ranking: [...BASE_STRENGTH_ORDER.ranking].reverse(),
            revolution: false,
          },
          finished: true,
        },
      ),
    ).toEqual([]);
  });

  it('通常状態から革命を起こす最後の3では反則あがりにしない', () => {
    expect(
      afterPlay(setPlay('3', 4), {
        active: false,
        strength: NORMAL_STRENGTH,
        finished: true,
      }),
    ).toEqual([
      {
        type: 'setMemory',
        scope: 'game',
        key: 'active',
        value: true,
      },
    ]);
  });

  it('革命返しを起こす最後の3ではプレイ直前の革命を見て最低順位にする', () => {
    expect(
      afterPlay(setPlay('3', 4), {
        active: true,
        strength: REVOLUTION_STRENGTH,
        finished: true,
      }),
    ).toEqual([
      {
        type: 'setMemory',
        scope: 'game',
        key: 'active',
        value: false,
      },
      {
        type: 'forceRank',
        player: PLAYER,
        rank: 'lowest',
      },
    ]);
  });
});
