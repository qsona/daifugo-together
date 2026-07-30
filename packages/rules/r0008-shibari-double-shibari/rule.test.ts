import type {
  CardRank,
  NaturalCard,
  Play,
  RuleContext,
  RuleModule,
  Suit,
} from '@daifugo/core';
import { describe, expect, it, vi } from 'vitest';

const { rule } = (await vi.importActual('./rule.js')) as { rule: RuleModule };

const signature = (counts: [number, number, number, number]): string =>
  counts.join(',');

const card = (suit: Suit, rank: CardRank): NaturalCard => ({
  kind: 'natural',
  id: `${suit}-${rank}`,
  suit,
  rank,
});

const play = (...cards: NaturalCard[]): Play => ({
  kind: cards.length === 1 ? 'single' : 'set',
  cards,
  count: cards.length,
  repRank: cards[0]?.rank ?? '3',
});

const context = (memory: Record<string, string | null> = {}): RuleContext =>
  ({
    memory: {
      game: memory,
      set: {},
    },
  }) as unknown as RuleContext;

describe('縛り・ダブル縛り', () => {
  it('同じハート単体が連続すると縛りが発動し、以後ハートだけを許可する', () => {
    const heart = signature([0, 1, 0, 0]);
    const first = play(card('heart', '5'));
    const second = play(card('heart', '8'));

    expect(rule.hooks.afterPlay?.(context(), first)).toEqual([
      {
        type: 'setMemory',
        scope: 'game',
        key: 'previousSuits',
        value: heart,
      },
    ]);
    expect(
      rule.hooks.afterPlay?.(context({ previousSuits: heart }), second),
    ).toEqual([
      {
        type: 'setMemory',
        scope: 'game',
        key: 'previousSuits',
        value: heart,
      },
      {
        type: 'setMemory',
        scope: 'game',
        key: 'bindingSuits',
        value: heart,
      },
    ]);

    const bound = context({ bindingSuits: heart });
    expect(
      rule.hooks.modifyLegality?.(bound, play(card('heart', '10')), {
        legal: true,
      }),
    ).toEqual({ legal: true });
    expect(
      rule.hooks.modifyLegality?.(bound, play(card('spade', '10')), {
        legal: true,
      }),
    ).toEqual({ legal: false });
  });

  it('異なる単体スートが連続しても縛りは発動しない', () => {
    const heart = signature([0, 1, 0, 0]);

    expect(
      rule.hooks.afterPlay?.(
        context({ previousSuits: heart }),
        play(card('spade', '8')),
      ),
    ).toEqual([
      {
        type: 'setMemory',
        scope: 'game',
        key: 'previousSuits',
        value: signature([1, 0, 0, 0]),
      },
    ]);
  });

  it('ハートとスペードの同じペア構成が連続するとダブル縛りになる', () => {
    const heartSpade = signature([1, 1, 0, 0]);
    const second = play(card('heart', '10'), card('spade', '10'));

    expect(
      rule.hooks.afterPlay?.(context({ previousSuits: heartSpade }), second),
    ).toContainEqual({
      type: 'setMemory',
      scope: 'game',
      key: 'bindingSuits',
      value: heartSpade,
    });

    const bound = context({ bindingSuits: heartSpade });
    expect(
      rule.hooks.modifyLegality?.(
        bound,
        play(card('spade', 'J'), card('heart', 'J')),
        { legal: true },
      ),
    ).toEqual({ legal: true });
    expect(
      rule.hooks.modifyLegality?.(
        bound,
        play(card('heart', 'J'), card('diamond', 'J')),
        { legal: true },
      ),
    ).toEqual({ legal: false });
  });

  it('ハート・スペードの後のハート・ダイヤでは発動しない', () => {
    const heartSpade = signature([1, 1, 0, 0]);

    expect(
      rule.hooks.afterPlay?.(
        context({ previousSuits: heartSpade }),
        play(card('heart', '10'), card('diamond', '10')),
      ),
    ).not.toContainEqual(expect.objectContaining({ key: 'bindingSuits' }));
  });

  it('複数枚の列挙順が違っても同じスート構成として扱う', () => {
    const heartSpade = signature([1, 1, 0, 0]);

    expect(
      rule.hooks.afterPlay?.(
        context({ previousSuits: heartSpade }),
        play(card('spade', '10'), card('heart', '10')),
      ),
    ).toContainEqual({
      type: 'setMemory',
      scope: 'game',
      key: 'bindingSuits',
      value: heartSpade,
    });
  });

  it('パス相当の状態変化がなくても縛りの合法性制限を維持する', () => {
    const heart = signature([0, 1, 0, 0]);
    const boundAfterPass = context({ bindingSuits: heart });

    expect(
      rule.hooks.modifyLegality?.(boundAfterPass, play(card('spade', '9')), {
        legal: true,
      }),
    ).toEqual({ legal: false });
  });

  it('場が流れると直前の手と縛りの記憶を解除する', () => {
    expect(rule.hooks.afterFieldClear?.(context())).toEqual([
      {
        type: 'setMemory',
        scope: 'game',
        key: 'previousSuits',
        value: null,
      },
      {
        type: 'setMemory',
        scope: 'game',
        key: 'bindingSuits',
        value: null,
      },
    ]);

    const base = { legal: true } as const;
    expect(
      rule.hooks.modifyLegality?.(
        context({ bindingSuits: null }),
        play(card('spade', '9')),
        base,
      ),
    ).toEqual(base);
  });

  it('縛り成立手で直ちに場が流れると解除効果が最後に適用される', () => {
    const heart = signature([0, 1, 0, 0]);
    const activation =
      rule.hooks.afterPlay?.(
        context({ previousSuits: heart }),
        play(card('heart', '8')),
      ) ?? [];
    const reset = rule.hooks.afterFieldClear?.(context()) ?? [];
    const memory: Record<string, string | null> = {};

    for (const effect of [...activation, ...reset]) {
      if (effect.type === 'setMemory') {
        memory[effect.key] =
          typeof effect.value === 'string' ? effect.value : null;
      }
    }

    expect(memory).toEqual({
      previousSuits: null,
      bindingSuits: null,
    });
  });
});
