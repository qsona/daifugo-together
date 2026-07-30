import type {
  Card,
  CardRank,
  JokerCard,
  NaturalCard,
  Play,
  PlayKind,
  RuleContext,
  RuleModule,
  Suit,
} from '@daifugo/core';
import { describe, expect, it, vi } from 'vitest';

const { rule } = (await vi.importActual('./rule.js')) as { rule: RuleModule };

const suits = (counts: [number, number, number, number]): string =>
  counts.join(',');

const card = (suit: Suit, rank: CardRank): NaturalCard => ({
  kind: 'natural',
  id: `${suit}-${rank}`,
  suit,
  rank,
});

const joker = (index: 0 | 1 = 0): JokerCard => ({
  kind: 'joker',
  id: `joker-${String(index)}`,
  index,
});

function play(kind: PlayKind, ...cards: Card[]): Play {
  const natural = cards.find(
    (candidate): candidate is NaturalCard => candidate.kind === 'natural',
  );
  return {
    kind,
    cards,
    count: cards.length,
    repRank: natural?.rank ?? 'joker',
  };
}

const single = (cardValue: Card): Play => play('single', cardValue);
const set = (...cards: Card[]): Play => play('set', ...cards);

const context = (memory: Record<string, string | null> = {}): RuleContext =>
  ({
    memory: {
      game: memory,
      set: {},
    },
  }) as unknown as RuleContext;

describe('縛り・ダブル縛り', () => {
  it('同じハート単体が連続すると縛りが発動し、以後ハートだけを許可する', () => {
    const heart = suits([0, 1, 0, 0]);
    expect(
      rule.hooks.afterPlay?.(
        context({ previousSuits: heart }),
        single(card('heart', '8')),
      ),
    ).toContainEqual({
      type: 'setMemory',
      scope: 'game',
      key: 'bindingSuits',
      value: heart,
    });

    const bound = context({ bindingSuits: heart });
    expect(
      rule.hooks.modifyLegality?.(bound, single(card('heart', '10')), {
        legal: true,
      }),
    ).toEqual({ legal: true });
    expect(
      rule.hooks.modifyLegality?.(bound, single(card('spade', '10')), {
        legal: true,
      }),
    ).toEqual({ legal: false });
  });

  it('異なる単体スートが連続しても縛りは発動しない', () => {
    expect(
      rule.hooks.afterPlay?.(
        context({ previousSuits: suits([0, 1, 0, 0]) }),
        single(card('spade', '8')),
      ),
    ).not.toContainEqual(expect.objectContaining({ key: 'bindingSuits' }));
  });

  it('同じ複数スート構成は列挙順に関係なくダブル縛りになる', () => {
    const heartSpade = suits([1, 1, 0, 0]);
    expect(
      rule.hooks.afterPlay?.(
        context({ previousSuits: heartSpade }),
        set(card('heart', '10'), card('spade', '10')),
      ),
    ).toContainEqual({
      type: 'setMemory',
      scope: 'game',
      key: 'bindingSuits',
      value: heartSpade,
    });
    expect(
      rule.hooks.afterPlay?.(
        context({ previousSuits: heartSpade }),
        set(card('spade', 'J'), card('heart', 'J')),
      ),
    ).toContainEqual(
      expect.objectContaining({ key: 'bindingSuits', value: heartSpade }),
    );
  });

  it('ハート・スペードの後のハート・ダイヤでは発動しない', () => {
    expect(
      rule.hooks.afterPlay?.(
        context({ previousSuits: suits([1, 1, 0, 0]) }),
        set(card('heart', '10'), card('diamond', '10')),
      ),
    ).not.toContainEqual(expect.objectContaining({ key: 'bindingSuits' }));
  });

  it('単体JOKERは既存の単体縛りを任意のスートとして満たす', () => {
    const base = { legal: true } as const;
    expect(
      rule.hooks.modifyLegality?.(
        context({ bindingSuits: suits([0, 1, 0, 0]) }),
        single(joker()),
        base,
      ),
    ).toEqual(base);
  });

  it('ダブル縛りでは自然札とJOKERで不足スートだけを代用する', () => {
    const bound = context({ bindingSuits: suits([1, 1, 0, 0]) });
    expect(
      rule.hooks.modifyLegality?.(bound, set(card('heart', '10'), joker()), {
        legal: true,
      }),
    ).toEqual({ legal: true });
    expect(
      rule.hooks.modifyLegality?.(bound, set(card('diamond', '10'), joker()), {
        legal: true,
      }),
    ).toEqual({ legal: false });
  });

  it('2枚のJOKERだけでも既存のダブル縛りを満たせる', () => {
    expect(
      rule.hooks.modifyLegality?.(
        context({ bindingSuits: suits([1, 1, 0, 0]) }),
        set(joker(0), joker(1)),
        { legal: true },
      ),
    ).toEqual({ legal: true });
  });

  it('階段のJOKERは自然札と同じスートを代用する', () => {
    const sequence = play(
      'sequence',
      card('heart', '5'),
      card('heart', '6'),
      joker(),
    );
    expect(
      rule.hooks.modifyLegality?.(
        context({ bindingSuits: suits([0, 3, 0, 0]) }),
        sequence,
        { legal: true },
      ),
    ).toEqual({ legal: true });
  });

  it('JOKERを含む現在手は新しい縛りを作らず、直前手の記憶を切る', () => {
    expect(
      rule.hooks.afterPlay?.(
        context({ previousSuits: suits([1, 1, 0, 0]) }),
        set(card('heart', '10'), joker()),
      ),
    ).toEqual([
      {
        type: 'setMemory',
        scope: 'game',
        key: 'previousSuits',
        value: null,
      },
    ]);
  });

  it('ハートとJOKERの直後の手との間にも新しい縛りを作らない', () => {
    const afterJokerPlay = context({ previousSuits: null });
    expect(
      rule.hooks.afterPlay?.(
        afterJokerPlay,
        set(card('heart', 'J'), card('spade', 'J')),
      ),
    ).not.toContainEqual(expect.objectContaining({ key: 'bindingSuits' }));
  });

  it('既存の縛り中にJOKERを代用しても縛りは変更しない', () => {
    const heartSpade = suits([1, 1, 0, 0]);
    expect(
      rule.hooks.afterPlay?.(
        context({
          previousSuits: heartSpade,
          bindingSuits: heartSpade,
        }),
        set(card('heart', '10'), joker()),
      ),
    ).toEqual([
      {
        type: 'setMemory',
        scope: 'game',
        key: 'previousSuits',
        value: null,
      },
    ]);
  });

  it('パス相当の状態変化がなくても縛りを維持し、baseの不合法性も覆さない', () => {
    const bound = context({ bindingSuits: suits([0, 1, 0, 0]) });
    expect(
      rule.hooks.modifyLegality?.(bound, single(card('spade', '9')), {
        legal: true,
      }),
    ).toEqual({ legal: false });
    expect(
      rule.hooks.modifyLegality?.(bound, single(card('heart', '9')), {
        legal: false,
        reasonKey: 'base',
      }),
    ).toEqual({ legal: false, reasonKey: 'base' });
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
  });

  it('縛り成立手で直ちに場が流れると解除効果が最後に適用される', () => {
    const heart = suits([0, 1, 0, 0]);
    const activation =
      rule.hooks.afterPlay?.(
        context({ previousSuits: heart }),
        single(card('heart', '8')),
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
