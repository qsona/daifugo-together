import type {
  Card,
  CardRank,
  JokerCard,
  NaturalCard,
  Play,
  PlayKind,
  PublicGameEvent,
  RuleContext,
  RuleModule,
  Suit,
} from '@daifugo/core';
import { BASE_STRENGTH_ORDER as STRENGTH } from '@daifugo/core';
import { describe, expect, it, vi } from 'vitest';

const { rule } = (await vi.importActual('./rule.js')) as { rule: RuleModule };

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

const played = (playValue: Play, player = 'p1'): PublicGameEvent => ({
  type: 'played',
  player,
  play: playValue,
});

const context = (history: PublicGameEvent[] = []): RuleContext =>
  ({
    contractVersion: 1,
    game: {
      gameIndex: 0,
      ruleIds: [rule.meta.ruleId],
      seats: ['p1', 'p2', 'p3', 'p4'],
      direction: 1,
      turn: 'p1',
      players: [],
      field: { passedSinceLastPlay: [] },
      discard: [],
      history,
      strength: STRENGTH,
    },
    setHistory: [],
    memory: { game: {}, set: {} },
    rng: { next: () => 0.5, int: () => 0 },
  }) as RuleContext;

const bound = (first: Play, second: Play): RuleContext =>
  context([played(first), played(second, 'p2')]);

describe('縛り・ダブル縛り', () => {
  it('同じハート単体が連続すると縛りが発動し、以後ハートだけを許可する', () => {
    const heartFive = single(card('heart', '5'));
    const heartEight = single(card('heart', '8'));
    expect(
      rule.hooks.afterPlay?.(context([played(heartFive)]), heartEight),
    ).toEqual([{ type: 'announce', messageKey: 'bindingActivated' }]);

    const heartBound = bound(heartFive, heartEight);
    expect(
      rule.hooks.modifyLegality?.(heartBound, single(card('heart', '10')), {
        legal: true,
      }),
    ).toEqual({ legal: true });
    expect(
      rule.hooks.modifyLegality?.(heartBound, single(card('spade', '10')), {
        legal: true,
      }),
    ).toEqual({ legal: false });
  });

  it('異なる単体スートが連続しても縛りは発動しない', () => {
    const heartFive = single(card('heart', '5'));
    expect(
      rule.hooks.afterPlay?.(
        context([played(heartFive)]),
        single(card('spade', '8')),
      ),
    ).toEqual([]);
  });

  it('同じ複数スート構成は列挙順に関係なくダブル縛りになる', () => {
    const first = set(card('heart', '7'), card('spade', '7'));
    const second = set(card('heart', '10'), card('spade', '10'));
    expect(rule.hooks.afterPlay?.(context([played(first)]), second)).toEqual([
      { type: 'announce', messageKey: 'bindingActivated' },
    ]);
    expect(
      rule.hooks.afterPlay?.(
        context([played(first)]),
        set(card('spade', 'J'), card('heart', 'J')),
      ),
    ).toEqual([{ type: 'announce', messageKey: 'bindingActivated' }]);
  });

  it('ハート・スペードの後のハート・ダイヤでは発動しない', () => {
    expect(
      rule.hooks.afterPlay?.(
        context([played(set(card('heart', '7'), card('spade', '7')))]),
        set(card('heart', '10'), card('diamond', '10')),
      ),
    ).toEqual([]);
  });

  it('ダブル縛り成立後は異なるスート構成のペアを禁止する', () => {
    const pairBound = bound(
      set(card('heart', '7'), card('spade', '7')),
      set(card('heart', '10'), card('spade', '10')),
    );
    expect(
      rule.hooks.modifyLegality?.(
        pairBound,
        set(card('heart', 'J'), card('diamond', 'J')),
        { legal: true },
      ),
    ).toEqual({ legal: false });
    expect(
      rule.hooks.modifyLegality?.(
        pairBound,
        set(card('spade', 'J'), card('heart', 'J')),
        { legal: true },
      ),
    ).toEqual({ legal: true });
  });

  it('単体JOKERは既存の単体縛りを任意のスートとして満たす', () => {
    const heartBound = bound(
      single(card('heart', '5')),
      single(card('heart', '8')),
    );
    const base = { legal: true } as const;
    expect(
      rule.hooks.modifyLegality?.(heartBound, single(joker()), base),
    ).toEqual(base);
  });

  it('ダブル縛りでは自然札とJOKERで不足スートだけを代用する', () => {
    const pairBound = bound(
      set(card('heart', '7'), card('spade', '7')),
      set(card('heart', '9'), card('spade', '9')),
    );
    expect(
      rule.hooks.modifyLegality?.(
        pairBound,
        set(card('heart', '10'), joker()),
        {
          legal: true,
        },
      ),
    ).toEqual({ legal: true });
    expect(
      rule.hooks.modifyLegality?.(
        pairBound,
        set(card('diamond', '10'), joker()),
        {
          legal: true,
        },
      ),
    ).toEqual({ legal: false });
  });

  it('2枚のJOKERだけでも既存のダブル縛りを満たせる', () => {
    const pairBound = bound(
      set(card('heart', '7'), card('spade', '7')),
      set(card('heart', '9'), card('spade', '9')),
    );
    expect(
      rule.hooks.modifyLegality?.(pairBound, set(joker(0), joker(1)), {
        legal: true,
      }),
    ).toEqual({ legal: true });
  });

  it('階段のJOKERは自然札と同じスートを代用する', () => {
    const heartSequenceBound = bound(
      play(
        'sequence',
        card('heart', '3'),
        card('heart', '4'),
        card('heart', '5'),
      ),
      play(
        'sequence',
        card('heart', '7'),
        card('heart', '8'),
        card('heart', '9'),
      ),
    );
    const sequence = play(
      'sequence',
      card('heart', '5'),
      card('heart', '6'),
      joker(),
    );
    expect(
      rule.hooks.modifyLegality?.(heartSequenceBound, sequence, {
        legal: true,
      }),
    ).toEqual({ legal: true });
  });

  it('JOKERを含む現在手は新しい縛りを作らず、直前手の記憶を切る', () => {
    const previous = set(card('heart', '7'), card('spade', '7'));
    expect(
      rule.hooks.afterPlay?.(
        context([played(previous)]),
        set(card('heart', '10'), joker()),
      ),
    ).toEqual([]);
  });

  it('ハートとJOKERの直後の手との間にも新しい縛りを作らない', () => {
    const afterJokerPlay = context([played(set(card('heart', '7'), joker()))]);
    expect(
      rule.hooks.afterPlay?.(
        afterJokerPlay,
        set(card('heart', 'J'), card('spade', 'J')),
      ),
    ).toEqual([]);
  });

  it('既存の縛り中にJOKERを代用しても縛りは変更しない', () => {
    const history = [
      played(set(card('heart', '7'), card('spade', '7'))),
      played(set(card('heart', '9'), card('spade', '9')), 'p2'),
    ];
    expect(
      rule.hooks.afterPlay?.(
        context(history),
        set(card('heart', '10'), joker()),
      ),
    ).toEqual([]);
  });

  it('パス相当の状態変化がなくても縛りを維持し、baseの不合法性も覆さない', () => {
    const heartBound = context([
      played(single(card('heart', '5'))),
      { type: 'passed', player: 'p2' },
      played(single(card('heart', '8')), 'p3'),
      { type: 'passed', player: 'p4' },
    ]);
    expect(
      rule.hooks.modifyLegality?.(heartBound, single(card('spade', '9')), {
        legal: true,
      }),
    ).toEqual({ legal: false });
    expect(
      rule.hooks.modifyLegality?.(heartBound, single(card('heart', '9')), {
        legal: false,
        reasonKey: 'base',
      }),
    ).toEqual({ legal: false, reasonKey: 'base' });
  });

  it('場が流れると履歴上の縛りを解除し、カットインを出さない', () => {
    const history: PublicGameEvent[] = [
      played(single(card('heart', '5'))),
      played(single(card('heart', '8')), 'p2'),
      { type: 'fieldCleared', reason: 'allPassed', nextLeader: 'p2' },
      played(single(card('spade', '5')), 'p2'),
    ];
    expect(
      rule.hooks.modifyLegality?.(
        context(history),
        single(card('diamond', '8')),
        { legal: true },
      ),
    ).toEqual({ legal: true });
    expect(rule.hooks.afterFieldClear).toBeUndefined();
  });

  it('縛り未成立の通常プレイではカットインを出さない', () => {
    expect(
      rule.hooks.afterPlay?.(
        context([played(single(card('heart', '5')))]),
        single(card('spade', '8')),
      ),
    ).toEqual([]);
  });

  it('追加入力から再開した同じ手を直前手と誤認してカットインを出さない', () => {
    const previous = single(card('heart', '5'));
    const resumed = single(card('spade', '10'));

    expect(
      rule.hooks.afterPlay?.(
        context([played(previous), played(resumed, 'p2')]),
        resumed,
      ),
    ).toEqual([]);
  });

  it('追加入力からの再開でも直前手と同じスートなら正しく縛りを告知する', () => {
    const previous = single(card('heart', '5'));
    const resumed = single(card('heart', '10'));

    expect(
      rule.hooks.afterPlay?.(
        context([played(previous), played(resumed, 'p2')]),
        resumed,
      ),
    ).toEqual([{ type: 'announce', messageKey: 'bindingActivated' }]);
  });
});
