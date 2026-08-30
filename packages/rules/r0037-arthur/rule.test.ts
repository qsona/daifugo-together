import type {
  Card,
  CardRank,
  DeepReadonly,
  Play,
  RuleContext,
  RuleModule,
  StrengthOrder,
  Suit,
} from '@daifugo/core';
import { BASE_STRENGTH_ORDER, compareRanks } from '@daifugo/core';
import { describe, expect, it, vi } from 'vitest';

const { rule } = (await vi.importActual('./rule.js')) as { rule: RuleModule };

function natural(rank: CardRank, suit: Suit = 'spade'): Card {
  return { kind: 'natural', id: `${suit}-${rank}`, suit, rank };
}

function joker(index: 0 | 1 = 0): Card {
  return { kind: 'joker', id: `joker-${String(index)}`, index };
}

function play(
  kind: Play['kind'],
  cards: Card[],
  repRank: Play['repRank'],
): Play {
  return { kind, cards, count: cards.length, repRank };
}

function context(
  active: boolean,
  strength: DeepReadonly<StrengthOrder> = BASE_STRENGTH_ORDER,
): RuleContext {
  return {
    game: { strength },
    memory: { game: active ? { active: true } : {}, set: {} },
  } as unknown as RuleContext;
}

function modifiedStrength(base: StrengthOrder): StrengthOrder {
  return rule.hooks.modifyStrength?.(
    context(true, base),
    base,
  ) as StrengthOrder;
}

describe('アーサー', () => {
  it('自然なKをちょうど3枚含む合法な手でゲーム内の発動状態を設定する', () => {
    const kings = play(
      'set',
      [natural('K', 'spade'), natural('K', 'heart'), natural('K', 'diamond')],
      'K',
    );

    expect(rule.hooks.afterPlay?.(context(false), kings)).toEqual([
      {
        type: 'setMemory',
        scope: 'game',
        key: 'active',
        value: true,
      },
    ]);
  });

  it.each([0, 1, 2, 4])('自然なKが%d枚の手では発動しない', (kingCount) => {
    const suits: Suit[] = ['spade', 'heart', 'diamond', 'club'];
    const cards = suits.slice(0, kingCount).map((suit) => natural('K', suit));
    if (cards.length === 0) cards.push(natural('Q'));

    expect(
      rule.hooks.afterPlay?.(
        context(false),
        play(
          cards.length === 1 ? 'single' : 'set',
          cards,
          kingCount === 0 ? 'Q' : 'K',
        ),
      ),
    ).toEqual([]);
  });

  it('ジョーカーで不足するKを代用しても発動しない', () => {
    const substituted = play(
      'set',
      [natural('K', 'spade'), natural('K', 'heart'), joker()],
      'K',
    );

    expect(rule.hooks.afterPlay?.(context(false), substituted)).toEqual([]);
  });

  it('発動前はジョーカーの代用と従来の最強比較を変更しない', () => {
    const base = { legal: true } as const;
    const substitutedSet = play('set', [natural('7'), joker()], '7');
    const substitutedSequence = play(
      'sequence',
      [natural('4'), natural('5'), joker()],
      '6',
    );

    expect(
      rule.hooks.modifyLegality?.(context(false), substitutedSet, base),
    ).toBe(base);
    expect(
      rule.hooks.modifyLegality?.(context(false), substitutedSequence, base),
    ).toBe(base);
    expect(
      rule.hooks.modifyStrength?.(context(false), BASE_STRENGTH_ORDER),
    ).toBe(BASE_STRENGTH_ORDER);
    expect(compareRanks('joker', '2', BASE_STRENGTH_ORDER)).toBeGreaterThan(0);
  });

  it('発動後は組と階段でのジョーカー代用を不正にする', () => {
    const base = { legal: true } as const;

    expect(
      rule.hooks.modifyLegality?.(
        context(true),
        play('set', [natural('7'), joker()], '7'),
        base,
      ),
    ).toEqual({ legal: false });
    expect(
      rule.hooks.modifyLegality?.(
        context(true),
        play('sequence', [natural('4'), natural('5'), joker()], '6'),
        base,
      ),
    ).toEqual({ legal: false });
    expect(
      rule.hooks.modifyLegality?.(
        context(true),
        play('single', [joker()], 'joker'),
        base,
      ),
    ).toBe(base);
    expect(
      rule.hooks.modifyLegality?.(
        context(true),
        play('set', [joker(0), joker(1)], 'joker'),
        base,
      ),
    ).toBe(base);
  });

  it('通常時のジョーカーを10より強くJより弱い位置にする', () => {
    const strength = modifiedStrength({
      ranking: [...BASE_STRENGTH_ORDER.ranking],
    });

    expect(compareRanks('joker', '10', strength)).toBeGreaterThan(0);
    expect(compareRanks('joker', 'J', strength)).toBeLessThan(0);
    expect(compareRanks('joker', '3', strength)).toBeGreaterThan(0);
    expect(compareRanks('joker', '2', strength)).toBeLessThan(0);
  });

  it('革命中も反転した10とJの間にジョーカーを置く', () => {
    const strength = modifiedStrength({
      ranking: [...BASE_STRENGTH_ORDER.ranking].reverse(),
      revolution: true,
    });

    expect(compareRanks('joker', 'J', strength)).toBeGreaterThan(0);
    expect(compareRanks('joker', '10', strength)).toBeLessThan(0);
    expect(compareRanks('joker', '2', strength)).toBeGreaterThan(0);
    expect(compareRanks('joker', '3', strength)).toBeLessThan(0);
  });

  it('発動済みなら条件を再度満たしても効果を重複させない', () => {
    const kings = play(
      'set',
      [natural('K', 'spade'), natural('K', 'heart'), natural('K', 'diamond')],
      'K',
    );

    expect(rule.hooks.afterPlay?.(context(true), kings)).toEqual([]);
  });

  it('次ゲームの空のゲームメモリでは発動前の挙動に戻る', () => {
    const base = { legal: true } as const;
    const substituted = play('set', [natural('7'), joker()], '7');

    expect(rule.hooks.modifyLegality?.(context(false), substituted, base)).toBe(
      base,
    );
  });
});
