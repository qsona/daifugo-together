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

const normal: StrengthOrder = { ranking: [...CARD_RANKS] };
const reversed: StrengthOrder = { ranking: [...CARD_RANKS].reverse() };

function natural(id: string, rank: '3' | '4' | 'J'): Card {
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

function context(
  options: {
    history?: PublicGameEvent[];
    memory?: Record<string, JsonValue>;
    strength?: StrengthOrder;
  } = {},
): RuleContext {
  return {
    contractVersion: 1,
    game: {
      gameIndex: 0,
      ruleIds: [rule.meta.ruleId],
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
): DeepReadonly<StrengthOrder> {
  const hook = rule.hooks.modifyStrength;
  if (!hook) throw new Error('modifyStrength hook is required');
  return hook(context({ history, memory: { activeWindow: memory } }), base);
}

describe('強化Jバック', () => {
  it('自然なJ 1枚の発動手番を除き、次の1手番だけ反転する', () => {
    const triggerHistory = [played('p1', [natural('SJ', 'J')])];
    const memory = activationMemory(triggerHistory, [natural('SJ', 'J')]);

    expect(strength(triggerHistory, memory).ranking).toEqual(reversed.ranking);
    expect(strength([...triggerHistory, played('p2')], memory).ranking).toEqual(
      normal.ranking,
    );
  });

  it('自然なJ 2枚なら2手番が完了するまで反転する', () => {
    const jacks = [natural('SJ', 'J'), natural('HJ', 'J')];
    const triggerHistory = [played('p1', jacks)];
    const memory = activationMemory(triggerHistory, jacks);
    const afterOneTurn = [...triggerHistory, played('p2')];

    expect(strength(triggerHistory, memory).ranking).toEqual(reversed.ranking);
    expect(strength(afterOneTurn, memory).ranking).toEqual(reversed.ranking);
    expect(strength([...afterOneTurn, played('p3')], memory).ranking).toEqual(
      normal.ranking,
    );
  });

  it('J以外とジョーカーによるJ代用では発動しない', () => {
    const hook = rule.hooks.afterPlay;
    if (!hook) throw new Error('afterPlay hook is required');

    expect(hook(context(), play([natural('S04', '4')]))).toEqual([]);
    expect(hook(context(), play([joker]))).toEqual([]);
    expect(hook(context(), play([natural('SJ', 'J'), joker]))).toMatchObject([
      { type: 'setMemory', value: { duration: 1 } },
    ]);
  });

  it('通常パスと自動スキップを同じpassed手番として数える', () => {
    const jacks = [natural('SJ', 'J'), natural('HJ', 'J')];
    const triggerHistory = [played('p1', jacks)];
    const memory = activationMemory(triggerHistory, jacks);
    const afterPass = [
      ...triggerHistory,
      { type: 'passed', player: 'p2' } as const,
    ];

    expect(strength(afterPass, memory).ranking).toEqual(reversed.ranking);
    expect(
      strength([...afterPass, { type: 'passed', player: 'p3' }], memory)
        .ranking,
    ).toEqual(normal.ranking);
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

    expect(strength(afterClear, memory).ranking).toEqual(reversed.ranking);
  });

  it('永続革命を保ったまま一時的に通常方向へ戻す', () => {
    const triggerHistory = [played('p1', [natural('SJ', 'J')])];
    const memory = activationMemory(triggerHistory, [natural('SJ', 'J')]);
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
      strength([...triggerHistory, played('p2')], memory, revolution),
    ).toEqual(revolution);
  });

  it('効果中に革命が切り替わっても現在の基準を一度だけ反転する', () => {
    const jacks = [natural('SJ', 'J'), natural('HJ', 'J')];
    const triggerHistory = [played('p1', jacks)];
    const memory = activationMemory(triggerHistory, jacks);

    expect(strength(triggerHistory, memory, normal).ranking).toEqual(
      reversed.ranking,
    );
    expect(
      strength(triggerHistory, memory, {
        ...reversed,
        revolution: true,
      }),
    ).toEqual({ ranking: normal.ranking, revolution: true });
  });

  it('効果中のJプレイは新しい自然なJ枚数で期間を更新する', () => {
    const firstHistory = [played('p1', [natural('SJ', 'J')])];
    const initialMemory = activationMemory(firstHistory, [natural('SJ', 'J')]);
    const secondJacks = [natural('HJ', 'J'), natural('DJ', 'J')];
    const retriggerHistory = [...firstHistory, played('p2', secondJacks)];
    const refreshedMemory = activationMemory(retriggerHistory, secondJacks);

    expect(strength(retriggerHistory, initialMemory).ranking).toEqual(
      normal.ranking,
    );
    expect(strength(retriggerHistory, refreshedMemory).ranking).toEqual(
      reversed.ranking,
    );
    expect(
      strength([...retriggerHistory, played('p3')], refreshedMemory).ranking,
    ).toEqual(reversed.ranking);
  });
});
