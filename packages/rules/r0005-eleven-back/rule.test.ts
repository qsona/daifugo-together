import type {
  Card,
  CardRank,
  Play,
  RuleContext,
  RuleModule,
  StrengthOrder,
} from '@daifugo/core';
import { describe, expect, it, vi } from 'vitest';

const { rule } = (await vi.importActual('./rule.js')) as { rule: RuleModule };

const NORMAL_RANKING: StrengthOrder['ranking'] = [
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
];

const REVOLUTION_RANKING = [...NORMAL_RANKING].reverse();

const naturalCard = (rank: CardRank): Card => ({
  kind: 'natural',
  id: `S-${rank}`,
  suit: 'spade',
  rank,
});

const playWith = (...cards: Card[]): Play => ({
  kind: cards.length === 1 ? 'single' : 'set',
  cards,
  count: cards.length,
  repRank: cards[0]?.kind === 'natural' ? cards[0].rank : 'joker',
});

const contextWith = (active: boolean): RuleContext =>
  ({
    memory: {
      game: { active },
      set: {},
    },
  }) as unknown as RuleContext;

describe('イレブンバック', () => {
  it('Jを含む手の後は通常時の強さ順を場が流れるまで反転する', () => {
    const beforePlay = contextWith(false);
    const normal: StrengthOrder = {
      ranking: NORMAL_RANKING,
      revolution: false,
    };

    expect(rule.hooks?.modifyStrength?.(beforePlay, normal)).toEqual(normal);
    expect(
      rule.hooks?.afterPlay?.(beforePlay, playWith(naturalCard('J'))),
    ).toEqual([
      {
        type: 'setMemory',
        scope: 'game',
        key: 'active',
        value: true,
      },
    ]);
    expect(rule.hooks?.modifyStrength?.(contextWith(true), normal)).toEqual({
      ranking: REVOLUTION_RANKING,
    });
  });

  it('革命中はJを含む手の後だけ通常の強さ順へ戻す', () => {
    const revolution: StrengthOrder = {
      ranking: REVOLUTION_RANKING,
      revolution: true,
    };

    expect(rule.hooks?.modifyStrength?.(contextWith(true), revolution)).toEqual(
      {
        ranking: NORMAL_RANKING,
      },
    );
  });

  it('Jを含まない手では発動せず現在の強さ順を維持する', () => {
    const context = contextWith(false);
    const revolution: StrengthOrder = {
      ranking: REVOLUTION_RANKING,
      revolution: true,
    };

    expect(
      rule.hooks?.afterPlay?.(context, playWith(naturalCard('10'))),
    ).toEqual([]);
    expect(rule.hooks?.modifyStrength?.(context, revolution)).toEqual(
      revolution,
    );
  });

  it('場が流れると一時反転を解除して直前の基準へ戻す', () => {
    expect(rule.hooks?.afterFieldClear?.(contextWith(true))).toEqual([
      {
        type: 'setMemory',
        scope: 'game',
        key: 'active',
        value: false,
        silent: true,
      },
    ]);

    const normal: StrengthOrder = {
      ranking: NORMAL_RANKING,
      revolution: false,
    };
    const revolution: StrengthOrder = {
      ranking: REVOLUTION_RANKING,
      revolution: true,
    };
    expect(rule.hooks?.modifyStrength?.(contextWith(false), normal)).toEqual(
      normal,
    );
    expect(
      rule.hooks?.modifyStrength?.(contextWith(false), revolution),
    ).toEqual(revolution);
  });

  it('Jを出せるかは発動前の強さ順で判定される', () => {
    const context = contextWith(false);
    const normal: StrengthOrder = {
      ranking: NORMAL_RANKING,
      revolution: false,
    };

    expect(rule.hooks?.modifyStrength?.(context, normal)).toEqual(normal);
    expect(
      rule.hooks?.afterPlay?.(context, playWith(naturalCard('J'))),
    ).toHaveLength(1);
    expect(rule.hooks?.modifyStrength?.(context, normal)).toEqual(normal);
  });

  it('一時反転中も革命状態そのものは変更しない', () => {
    const normal: StrengthOrder = {
      ranking: NORMAL_RANKING,
      revolution: false,
    };
    const revolution: StrengthOrder = {
      ranking: REVOLUTION_RANKING,
      revolution: true,
    };

    expect(
      rule.hooks?.modifyStrength?.(contextWith(true), normal),
    ).not.toHaveProperty('revolution');
    expect(
      rule.hooks?.modifyStrength?.(contextWith(true), revolution),
    ).not.toHaveProperty('revolution');
  });

  it('Jを出した手で同時に場が流れる場合は一時反転を残さない', () => {
    const context = contextWith(false);
    const activation =
      rule.hooks?.afterPlay?.(context, playWith(naturalCard('J'))) ?? [];
    const reset = rule.hooks?.afterFieldClear?.(contextWith(true)) ?? [];

    expect(activation.at(-1)).toMatchObject({
      type: 'setMemory',
      key: 'active',
      value: true,
    });
    expect(reset.at(-1)).toMatchObject({
      type: 'setMemory',
      key: 'active',
      value: false,
      silent: true,
    });
  });

  it('発動中にもう一度Jを出した場合もその瞬間だけ発動を通知する', () => {
    expect(
      rule.hooks?.afterPlay?.(contextWith(true), playWith(naturalCard('J'))),
    ).toEqual([{ type: 'announce', messageKey: 'activated' }]);
  });

  it('未発動のまま場が流れた場合は解除処理も通知もしない', () => {
    expect(rule.hooks?.afterFieldClear?.(contextWith(false))).toEqual([]);
  });
});
