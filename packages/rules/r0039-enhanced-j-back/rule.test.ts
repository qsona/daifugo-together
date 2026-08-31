import {
  CARD_RANKS,
  type Card,
  type DeepReadonly,
  type JsonValue,
  type Play,
  type PublicGameEvent,
  type RuleContext,
  type StrengthOrder,
} from '@daifugo/core';
import { describe, expect, it } from 'vitest';

import { rule } from './rule.js';

const ELEVEN_BACK_RULE_ID = 'r0005-eleven-back';
const SIX_RETURN_RULE_ID = 'r0019-6-modoshi';
const WINDOW_KEY = 'activeWindow';

const normal: StrengthOrder = { ranking: [...CARD_RANKS] };
const reversed: StrengthOrder = { ranking: [...CARD_RANKS].reverse() };

function natural(id: string, rank: '3' | '4' | '6' | 'J'): Card {
  return { kind: 'natural', id, suit: 'spade', rank };
}

const joker: Card = { kind: 'joker', id: 'JK0', index: 0 };

function play(cards: Card[]): Play {
  return {
    kind: cards.length === 1 ? 'single' : 'set',
    cards,
    count: cards.length,
    repRank: cards.find((card) => card.kind === 'natural')?.rank ?? 'joker',
  };
}

function played(
  player: string,
  cards: Card[] = [natural('S03', '3')],
): PublicGameEvent {
  return { type: 'played', player, play: play(cards) };
}

function elevenBackFired(): PublicGameEvent {
  return {
    type: 'ruleFired',
    ruleId: ELEVEN_BACK_RULE_ID,
    messageKey: null,
  };
}

function context(
  options: {
    history?: PublicGameEvent[];
    memory?: Record<string, JsonValue>;
    strength?: StrengthOrder;
    ruleIds?: string[];
  } = {},
): RuleContext {
  return {
    contractVersion: 1,
    game: {
      gameIndex: 0,
      ruleIds: options.ruleIds ?? [rule.meta.ruleId],
      seats: ['p1', 'p2', 'p3', 'p4'],
      direction: 1,
      turn: 'p1',
      players: ['p1', 'p2', 'p3', 'p4'].map((id) => ({
        id,
        hand: [],
        status: 'active' as const,
        standing: null,
      })),
      field: { passedSinceLastPlay: [] },
      discard: [],
      history: options.history ?? [],
      strength: options.strength ?? normal,
    },
    setHistory: [],
    memory: { game: options.memory ?? {}, set: {} },
    rng: { next: () => 0.5, int: () => 0 },
  };
}

function activationMemory(
  history: PublicGameEvent[],
  cards: Card[],
): JsonValue {
  const effect = rule.hooks.afterPlay?.(context({ history }), play(cards))[0];
  if (effect?.type !== 'setMemory') {
    throw new Error('expected activation memory');
  }
  return effect.value;
}

function strength(
  history: PublicGameEvent[],
  memory: JsonValue,
  base: StrengthOrder = normal,
  ruleIds: string[] = [rule.meta.ruleId],
): DeepReadonly<StrengthOrder> {
  const hook = rule.hooks.modifyStrength;
  if (!hook) throw new Error('modifyStrength hook is required');
  return hook(
    context({ history, memory: { [WINDOW_KEY]: memory }, ruleIds }),
    base,
  );
}

describe('強化Jバック', () => {
  it('自然なJ 1枚は強化効果を発動せず通常のイレブンバックに委ねる', () => {
    const hook = rule.hooks.afterPlay;
    if (!hook) throw new Error('afterPlay hook is required');
    const jack = natural('SJ', 'J');

    expect(hook(context(), play([jack]))).toEqual([]);

    const history = [played('p1', [jack]), elevenBackFired()];
    expect(
      strength(history, null, reversed, [
        ELEVEN_BACK_RULE_ID,
        rule.meta.ruleId,
      ]),
    ).toEqual(reversed);
  });

  it('自然なJ 2枚なら発動後の2手番が完了するまで反転する', () => {
    const jacks = [natural('SJ', 'J'), natural('HJ', 'J')];
    const triggerHistory = [played('p1', jacks)];
    const memory = activationMemory(triggerHistory, jacks);
    const afterOneTurn = [...triggerHistory, played('p2')];

    expect(strength(triggerHistory, memory).ranking).toEqual(reversed.ranking);
    expect(strength(afterOneTurn, memory).ranking).toEqual(reversed.ranking);
    expect(strength([...afterOneTurn, played('p3')], memory)).toEqual(normal);
  });

  it('通常のイレブンバックと同時に成立しても二重反転しない', () => {
    const jacks = [natural('SJ', 'J'), natural('HJ', 'J')];
    const trigger = played('p1', jacks);
    const history = [trigger, elevenBackFired()];
    const memory = activationMemory([trigger], jacks);

    expect(
      strength(history, memory, reversed, [
        ELEVEN_BACK_RULE_ID,
        rule.meta.ruleId,
      ]),
    ).toEqual(reversed);
  });

  it('強化期間終了後は場に残る通常反転を相殺し、場が流れると相殺しない', () => {
    const jacks = [natural('SJ', 'J'), natural('HJ', 'J')];
    const trigger = played('p1', jacks);
    const memory = activationMemory([trigger], jacks);
    const expired: PublicGameEvent[] = [
      trigger,
      elevenBackFired(),
      played('p2'),
      played('p3'),
    ];

    expect(
      strength(expired, memory, reversed, [
        ELEVEN_BACK_RULE_ID,
        rule.meta.ruleId,
      ]),
    ).toEqual(normal);

    const cleared: PublicGameEvent[] = [
      ...expired,
      { type: 'fieldCleared', reason: 'allPassed', nextLeader: 'p1' },
    ];
    expect(
      strength(cleared, memory, normal, [
        ELEVEN_BACK_RULE_ID,
        rule.meta.ruleId,
      ]),
    ).toEqual(normal);
  });

  it('通常のイレブンバックが無効でもJ 2枚で反転する', () => {
    const jacks = [natural('SJ', 'J'), natural('HJ', 'J')];
    const history = [played('p1', jacks)];
    const memory = activationMemory(history, jacks);

    expect(strength(history, memory)).toEqual(reversed);
  });

  it('J以外とジョーカー代用では発動せず、自然なJ 1枚とジョーカーも通常扱いにする', () => {
    const hook = rule.hooks.afterPlay;
    if (!hook) throw new Error('afterPlay hook is required');

    expect(hook(context(), play([natural('S04', '4')]))).toEqual([]);
    expect(hook(context(), play([joker]))).toEqual([]);
    expect(hook(context(), play([natural('SJ', 'J'), joker]))).toEqual([]);
  });

  it('通常パスと自動スキップを同じpassed手番として数える', () => {
    const jacks = [natural('SJ', 'J'), natural('HJ', 'J')];
    const triggerHistory = [played('p1', jacks)];
    const memory = activationMemory(triggerHistory, jacks);
    const afterPass = [
      ...triggerHistory,
      { type: 'passed', player: 'p2' } as const,
    ];

    expect(strength(afterPass, memory)).toEqual(reversed);
    expect(
      strength([...afterPass, { type: 'passed', player: 'p3' }], memory),
    ).toEqual(normal);
  });

  it('場が流れても残り手番がある限り継続する', () => {
    const jacks = [natural('SJ', 'J'), natural('HJ', 'J')];
    const triggerHistory = [played('p1', jacks)];
    const memory = activationMemory(triggerHistory, jacks);
    const afterClear: PublicGameEvent[] = [
      ...triggerHistory,
      { type: 'fieldCleared', reason: 'rule', nextLeader: 'p1' },
      { type: 'turnChanged', player: 'p1' },
    ];

    expect(strength(afterClear, memory)).toEqual(reversed);
  });

  it('永続革命と比較例外を保ったまま現在の基準だけを反転する', () => {
    const jacks = [natural('SJ', 'J'), natural('HJ', 'J')];
    const triggerHistory = [played('p1', jacks)];
    const memory = activationMemory(triggerHistory, jacks);
    const revolution: StrengthOrder = {
      ...reversed,
      revolution: true,
      comparisonOverrides: [{ stronger: '3', weaker: 'joker' }],
    };

    expect(strength(triggerHistory, memory, revolution)).toEqual({
      ranking: normal.ranking,
      revolution: true,
      comparisonOverrides: [{ stronger: '3', weaker: 'joker' }],
    });
    expect(
      strength(
        [...triggerHistory, played('p2'), played('p3')],
        memory,
        revolution,
      ),
    ).toEqual(revolution);
  });

  it('効果中のJ 2枚以上で期間を更新する', () => {
    const firstJacks = [natural('SJ', 'J'), natural('HJ', 'J')];
    const firstHistory = [played('p1', firstJacks)];
    const initialMemory = activationMemory(firstHistory, firstJacks);
    const secondJacks = [
      natural('DJ', 'J'),
      natural('CJ', 'J'),
      natural('XJ', 'J'),
    ];
    const retriggerHistory = [...firstHistory, played('p2', secondJacks)];
    const refreshedMemory = activationMemory(retriggerHistory, secondJacks);

    expect(
      strength([...retriggerHistory, played('p3')], initialMemory),
    ).toEqual(normal);
    expect(
      strength(
        [...retriggerHistory, played('p3'), played('p4')],
        refreshedMemory,
      ),
    ).toEqual(reversed);
  });

  it('効果中の自然なJ 1枚は強化期間をsilentに解除する', () => {
    const jacks = [natural('SJ', 'J'), natural('HJ', 'J')];
    const history = [played('p1', jacks)];
    const memory = activationMemory(history, jacks);
    const hook = rule.hooks.afterPlay;
    if (!hook) throw new Error('afterPlay hook is required');

    expect(
      hook(
        context({ memory: { [WINDOW_KEY]: memory } }),
        play([natural('DJ', 'J')]),
      ),
    ).toEqual([
      {
        type: 'setMemory',
        scope: 'game',
        key: WINDOW_KEY,
        value: null,
        silent: true,
      },
    ]);
  });

  it('6戻しが通常反転を解除しても強化期間の反転を保つ', () => {
    const jacks = [natural('SJ', 'J'), natural('HJ', 'J')];
    const trigger = played('p1', jacks);
    const memory = activationMemory([trigger], jacks);
    const history = [
      trigger,
      elevenBackFired(),
      played('p2', [natural('S06', '6')]),
    ];

    expect(
      strength(history, memory, normal, [
        ELEVEN_BACK_RULE_ID,
        SIX_RETURN_RULE_ID,
        rule.meta.ruleId,
      ]),
    ).toEqual(reversed);
  });
});
