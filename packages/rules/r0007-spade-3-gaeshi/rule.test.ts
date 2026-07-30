import {
  BASE_STRENGTH_ORDER,
  compareRanks,
  type Card,
  type Play,
  type RuleContext,
  type RuleModule,
  type StrengthOrder,
} from '@daifugo/core';
import { describe, expect, it, vi } from 'vitest';

const { rule } = (await vi.importActual('./rule.js')) as { rule: RuleModule };

const joker = (index: 0 | 1): Card => ({
  kind: 'joker',
  id: `JK${index}`,
  index,
});

const natural = (suit: 'spade' | 'heart', rank: '3' | '4'): Card => ({
  kind: 'natural',
  id: `${suit}-${rank}`,
  suit,
  rank,
});

const single = (card: Card): Play => ({
  kind: 'single',
  cards: [card],
  count: 1,
  repRank: card.kind === 'joker' ? 'joker' : card.rank,
});

const set = (...cards: Card[]): Play => ({
  kind: 'set',
  cards,
  count: cards.length,
  repRank: cards.every((card) => card.kind === 'joker')
    ? 'joker'
    : (cards.find((card) => card.kind === 'natural')?.rank ?? 'joker'),
});

function context(input: {
  field?: Play;
  passed?: string[];
  previousPlay?: Play;
}): RuleContext {
  return {
    game: {
      field: {
        ...(input.field ? { current: { play: input.field, by: 'p2' } } : {}),
        passedSinceLastPlay: input.passed ?? [],
      },
      history: input.previousPlay
        ? [{ type: 'played', player: 'p2', play: input.previousPlay }]
        : [],
    },
  } as unknown as RuleContext;
}

describe('スペ3返し', () => {
  it('単体ジョーカーにスペードの3を単体で出せる', () => {
    const field = single(joker(0));
    const spadeThree = single(natural('spade', '3'));

    expect(
      rule.hooks.modifyLegality?.(context({ field }), spadeThree, {
        legal: false,
        reasonKey: 'TOO_WEAK',
      }),
    ).toEqual({ legal: true });
  });

  it('単体ジョーカーに対する場合だけ3をジョーカーより強くする', () => {
    const field = single(joker(0));
    const base: StrengthOrder = {
      ...BASE_STRENGTH_ORDER,
      revolution: true,
    };
    const modified = rule.hooks.modifyStrength?.(context({ field }), base);

    expect(modified).toEqual({
      ...base,
      comparisonOverrides: [{ stronger: '3', weaker: 'joker' }],
    });
    expect(compareRanks('3', 'joker', modified as StrengthOrder)).toBe(1);
    expect(compareRanks('4', 'joker', modified as StrengthOrder)).toBeLessThan(
      0,
    );
  });

  it('成立後は場を流す', () => {
    const jokerPlay = single(joker(0));
    const spadeThree = single(natural('spade', '3'));

    expect(
      rule.hooks.afterPlay?.(
        context({ field: spadeThree, previousPlay: jokerPlay }),
        spadeThree,
      ),
    ).toEqual([{ type: 'clearField' }]);
  });

  it('途中でパスされても場の単体ジョーカーに対して成立する', () => {
    const field = single(joker(0));
    const spadeThree = single(natural('spade', '3'));

    expect(
      rule.hooks.modifyLegality?.(
        context({ field, passed: ['p3'] }),
        spadeThree,
        { legal: false, reasonKey: 'TOO_WEAK' },
      ),
    ).toEqual({ legal: true });
  });

  it('ジョーカー2枚組にスペードの3単体は出せない', () => {
    const field = set(joker(0), joker(1));
    const spadeThree = single(natural('spade', '3'));
    const base: StrengthOrder = { ...BASE_STRENGTH_ORDER };

    expect(
      rule.hooks.modifyLegality?.(context({ field }), spadeThree, {
        legal: false,
        reasonKey: 'TOO_WEAK',
      }),
    ).toEqual({ legal: false, reasonKey: 'TOO_WEAK' });
    expect(rule.hooks.modifyStrength?.(context({ field }), base)).toEqual(base);
  });

  it('ジョーカーが複数枚の手の一部なら発動しない', () => {
    const field = set(natural('heart', '4'), joker(0));
    const spadeThree = single(natural('spade', '3'));

    expect(
      rule.hooks.modifyLegality?.(context({ field }), spadeThree, {
        legal: false,
        reasonKey: 'TOO_WEAK',
      }),
    ).toEqual({ legal: false, reasonKey: 'TOO_WEAK' });
    expect(
      rule.hooks.afterPlay?.(
        context({ field: spadeThree, previousPlay: field }),
        spadeThree,
      ),
    ).toEqual([]);
  });

  it('単体ジョーカー以外では通常の合法性・強さ・場を維持する', () => {
    const field = single(natural('heart', '4'));
    const spadeThree = single(natural('spade', '3'));
    const baseLegality = { legal: false, reasonKey: 'TOO_WEAK' } as const;
    const baseStrength: StrengthOrder = { ...BASE_STRENGTH_ORDER };

    expect(
      rule.hooks.modifyLegality?.(context({ field }), spadeThree, baseLegality),
    ).toEqual(baseLegality);
    expect(
      rule.hooks.modifyStrength?.(context({ field }), baseStrength),
    ).toEqual(baseStrength);
    expect(
      rule.hooks.afterPlay?.(
        context({ field: spadeThree, previousPlay: field }),
        spadeThree,
      ),
    ).toEqual([]);
  });

  it('ハートの3には強さ例外を適用しない', () => {
    const field = single(joker(0));
    const heartThree = single(natural('heart', '3'));

    expect(
      rule.hooks.modifyLegality?.(context({ field }), heartThree, {
        legal: true,
      }),
    ).toEqual({ legal: false });
  });
});
