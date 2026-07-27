import type { Card, Play, RoomGameEvent } from '@daifugo/core';
import { describe, expect, it } from 'vitest';

import {
  createGuideState,
  reduceGuide,
  type GuideInput,
  type GuideState,
} from './guide';

function card(id: string, rank: Card['rank']): Card {
  return { kind: 'natural', id, suit: 'spade', rank };
}

function play(...cards: Card[]): Play {
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

  it('出せないカードのタップは初戦に1回だけ返し、2戦目では無効になる', () => {
    const first = step(createGuideState(), {
      type: 'illegalTap',
      gameNo: 1,
    });
    expect(first.cue).toBe('illegalTap');
    expect(step(first.state, { type: 'illegalTap', gameNo: 1 }).cue).toBeNull();
    expect(
      step(createGuideState(), { type: 'illegalTap', gameNo: 2 }).cue,
    ).toBeNull();
  });
});
