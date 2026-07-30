import type { Card, CardRank, Play, RoomGameEvent } from '@daifugo/core';
import { describe, expect, it } from 'vitest';

import {
  createGuideState,
  reduceGuide,
  type GuideInput,
  type GuideState,
} from './guide';

function card(id: string, rank: CardRank): Card & { kind: 'natural' } {
  return { kind: 'natural', id, suit: 'spade', rank };
}

function play(...cards: (Card & { kind: 'natural' })[]): Play {
  return {
    kind: cards.length === 1 ? 'single' : 'set',
    cards,
    count: cards.length,
    repRank: cards[0]!.rank,
  };
}

function snapshot(
  key: string,
  patch: Partial<Extract<GuideInput, { type: 'snapshot' }>> = {},
): Extract<GuideInput, { type: 'snapshot' }> {
  return {
    type: 'snapshot',
    key,
    gameNo: 1,
    isMyTurn: true,
    fieldCardCount: 0,
    legalMoves: [play(card('S03', '3'))],
    events: [],
    ...patch,
  };
}

function step(state: GuideState, input: GuideInput) {
  return reduceGuide(state, input);
}

describe('TU-03: reduceGuide', () => {
  it('最初の手番だけfirstTurnを返し、同じsnapshotの再送では再演出しない', () => {
    const first = step(createGuideState(), snapshot('room:1'));
    expect(first.cue).toBe('firstTurn');

    const repeated = step(first.state, snapshot('room:1'));
    expect(repeated.cue).toBeNull();
  });

  it('2回目の手番ではfirstTurnを返さない', () => {
    const first = step(createGuideState(), snapshot('room:1'));
    const second = step(
      first.state,
      snapshot('room:2', { legalMoves: [play(card('S04', '4'))] }),
    );

    expect(second.cue).not.toBe('firstTurn');
  });

  it('ペアを出せる次の機会にpairAvailableを返す', () => {
    const pair = play(card('S08', '8'), card('H08', '8'));
    const first = step(
      createGuideState(),
      snapshot('room:1', { legalMoves: [pair] }),
    );
    expect(first.cue).toBe('firstTurn');

    const next = step(first.state, snapshot('room:2', { legalMoves: [pair] }));
    expect(next.cue).toBe('pairAvailable');
  });

  it('合法手が0件ならnoLegalMoveを1回だけ返す', () => {
    const first = step(createGuideState(), snapshot('room:1'));
    const blocked = step(
      first.state,
      snapshot('room:2', {
        fieldCardCount: 1,
        legalMoves: [],
      }),
    );
    expect(blocked.cue).toBe('noLegalMove');

    const next = step(
      blocked.state,
      snapshot('room:3', {
        fieldCardCount: 1,
        legalMoves: [],
      }),
    );
    expect(next.cue).not.toBe('noLegalMove');
  });

  it('新しいfieldClearedのあと自分の番ならfieldClearedを返す', () => {
    const first = step(createGuideState(), snapshot('room:1'));
    const fieldCleared = {
      seq: 7,
      t: 'fieldCleared',
      reason: 'allPassed',
    } satisfies RoomGameEvent;
    const cleared = step(
      first.state,
      snapshot('room:2', { events: [fieldCleared] }),
    );

    expect(cleared.cue).toBe('fieldCleared');
  });

  it('2条件が同時でも1つだけ返し、残りは次のsnapshotで返す', () => {
    const pair = play(card('S08', '8'), card('H08', '8'));
    const first = step(
      createGuideState(),
      snapshot('room:1', { legalMoves: [pair] }),
    );
    expect(first.cue).toBe('firstTurn');

    const next = step(first.state, snapshot('room:2', { legalMoves: [pair] }));
    expect(next.cue).toBe('pairAvailable');
  });

  it('階段だけの複数枚合法手ではpairAvailableを出さず、setが混ざれば出す', () => {
    const sequence: Play = {
      kind: 'sequence',
      cards: [card('S03', '3'), card('S04', '4'), card('S05', '5')],
      count: 3,
      repRank: '5',
    };
    const first = step(
      createGuideState(),
      snapshot('room:1', { legalMoves: [sequence] }),
    );
    expect(first.cue).toBe('firstTurn');

    // 「おなじ数字は 2 枚 いっしょに出せるよ」は階段には当てはまらない。
    const sequenceOnly = step(
      first.state,
      snapshot('room:2', { legalMoves: [sequence] }),
    );
    expect(sequenceOnly.cue).toBeNull();

    const pair = play(card('S08', '8'), card('H08', '8'));
    const withPair = step(
      sequenceOnly.state,
      snapshot('room:3', { legalMoves: [sequence, pair] }),
    );
    expect(withPair.cue).toBe('pairAvailable');
  });

  it('2戦目ではガイドを返さない', () => {
    expect(
      step(createGuideState(), snapshot('room:1', { gameNo: 2 })).cue,
    ).toBeNull();
  });
});
