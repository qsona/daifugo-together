import {
  BASE_STRENGTH_ORDER,
  type Card,
  type Play,
  type PublicGameEvent,
  type RuleContext,
  type StrengthOrder,
} from '@daifugo/core';
import { describe, expect, it } from 'vitest';

import { rule } from './rule.js';

const player = 'p1';

function card(rank: '3' | '6' | '7' | 'J'): Card {
  return { kind: 'natural', id: `S${rank}`, suit: 'spade', rank };
}

function play(cards: Card[], kind: Play['kind'] = 'single'): Play {
  const first = cards[0];
  return {
    kind,
    cards,
    count: cards.length,
    repRank: first?.kind === 'natural' ? first.rank : 'joker',
  };
}

function played(cards: Card[], kind?: Play['kind']): PublicGameEvent {
  return { type: 'played', player, play: play(cards, kind) };
}

const elevenBackFired: PublicGameEvent = {
  type: 'ruleFired',
  ruleId: 'r0005-eleven-back',
  messageKey: null,
};

function context(history: PublicGameEvent[]): RuleContext {
  return {
    contractVersion: 1,
    game: {
      gameIndex: 0,
      seats: [player, 'p2', 'p3', 'p4'],
      direction: 1,
      turn: player,
      players: [
        { id: player, hand: [], status: 'active', standing: null },
        { id: 'p2', hand: [], status: 'active', standing: null },
        { id: 'p3', hand: [], status: 'active', standing: null },
        { id: 'p4', hand: [], status: 'active', standing: null },
      ],
      field: { passedSinceLastPlay: [] },
      discard: [],
      history,
      strength: BASE_STRENGTH_ORDER,
    },
    setHistory: [],
    memory: { game: {}, set: {} },
    rng: { next: () => 0, int: () => 0 },
  };
}

function modify(history: PublicGameEvent[], base: StrengthOrder) {
  return rule.hooks.modifyStrength?.(context(history), base);
}

describe('6戻し', () => {
  it('meta.jsonと同じメタデータを公開する', () => {
    expect(rule.meta).toEqual({
      ruleId: 'r0019-6-modoshi',
      name: '6戻し',
      description:
        'イレブンバックによる一時的な強さ反転中にランク6を含む手を出すと、その反転を解除し、強さ順を永続的な革命状態に対応する順序へ戻す。',
      kind: 'local',
      prefecture: '東京都',
      proposalId: '01KZ1FFN0PRM9V6DF8BQX2TWXE',
      contractVersion: 1,
      messages: {},
    });
    expect(Object.keys(rule.hooks)).toEqual(['modifyStrength']);
  });

  it('通常状態で6を出しても強さ順を変えない', () => {
    expect(modify([played([card('6')])], BASE_STRENGTH_ORDER)).toEqual(
      BASE_STRENGTH_ORDER,
    );
  });

  it('イレブンバック中に6を出すと通常の強さ順へ戻す', () => {
    const reversed = {
      ranking: [...BASE_STRENGTH_ORDER.ranking].reverse(),
    };
    expect(
      modify(
        [played([card('J')]), elevenBackFired, played([card('6')])],
        reversed,
      ),
    ).toEqual(BASE_STRENGTH_ORDER);
  });

  it('革命中のイレブンバックを解除して革命の強さ順へ戻す', () => {
    const elevenBackDuringRevolution: StrengthOrder = {
      ranking: [...BASE_STRENGTH_ORDER.ranking],
      revolution: true,
    };
    expect(
      modify(
        [played([card('J')]), elevenBackFired, played([card('6')])],
        elevenBackDuringRevolution,
      ),
    ).toEqual({
      ranking: [...BASE_STRENGTH_ORDER.ranking].reverse(),
      revolution: true,
    });
  });

  it('イレブンバック中でも6を含まない手では反転を維持する', () => {
    const reversed = {
      ranking: [...BASE_STRENGTH_ORDER.ranking].reverse(),
    };
    expect(
      modify(
        [played([card('J')]), elevenBackFired, played([card('7')])],
        reversed,
      ),
    ).toEqual(reversed);
  });

  it('複数枚の手や階段に自然札の6が含まれていても解除する', () => {
    const reversed = {
      ranking: [...BASE_STRENGTH_ORDER.ranking].reverse(),
    };
    const history = [
      played([card('J')]),
      elevenBackFired,
      played([card('3'), card('6'), card('7')], 'sequence'),
    ];
    expect(modify(history, reversed)).toEqual(BASE_STRENGTH_ORDER);
  });

  it('場が流れた後の6では発動しない', () => {
    const history: PublicGameEvent[] = [
      played([card('J')]),
      elevenBackFired,
      { type: 'fieldCleared', reason: 'allPassed', nextLeader: player },
      played([card('6')]),
    ];
    expect(modify(history, BASE_STRENGTH_ORDER)).toEqual(BASE_STRENGTH_ORDER);
  });
});
