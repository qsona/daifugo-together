import type { Play, RoomGameEvent } from '@daifugo/core';

export type GuideCue =
  | 'firstTurn'
  | 'followTurn'
  | 'pairAvailable'
  | 'noLegalMove'
  | 'illegalTap'
  | 'fieldCleared';

export type GuideState = {
  shown: readonly GuideCue[];
  seenSnapshots: readonly string[];
  lastEventSeq: number;
  hasSeenOwnTurn: boolean;
};

export type GuideInput =
  | {
      type: 'snapshot';
      key: string;
      gameNo: number;
      isMyTurn: boolean;
      fieldCardCount: number;
      legalMoves: readonly Play[] | null;
      events: readonly RoomGameEvent[];
    }
  | {
      type: 'illegalTap';
      gameNo: number;
    };

export function createGuideState(): GuideState {
  return {
    shown: [],
    seenSnapshots: [],
    lastEventSeq: 0,
    hasSeenOwnTurn: false,
  };
}

function show(
  state: GuideState,
  cue: GuideCue | undefined,
): { state: GuideState; cue: GuideCue | null } {
  if (!cue || state.shown.includes(cue)) return { state, cue: null };
  return {
    state: { ...state, shown: [...state.shown, cue] },
    cue,
  };
}

export function reduceGuide(
  state: GuideState,
  input: GuideInput,
): { state: GuideState; cue: GuideCue | null } {
  if (input.gameNo !== 1) return { state, cue: null };

  if (input.type === 'illegalTap') {
    return show(state, 'illegalTap');
  }

  if (state.seenSnapshots.includes(input.key)) {
    return { state, cue: null };
  }
  const lastEventSeq = Math.max(
    state.lastEventSeq,
    ...input.events.map((event) => event.seq),
  );
  const nextState: GuideState = {
    ...state,
    seenSnapshots: [...state.seenSnapshots, input.key],
    lastEventSeq,
    hasSeenOwnTurn: state.hasSeenOwnTurn || input.isMyTurn,
  };
  if (!input.isMyTurn) return { state: nextState, cue: null };

  const fieldCleared = input.events.some(
    (event) =>
      event.seq > state.lastEventSeq &&
      event.t === 'fieldCleared' &&
      event.reason === 'allPassed',
  );
  const candidates: GuideCue[] = [
    ...(fieldCleared ? (['fieldCleared'] as const) : []),
    ...(!state.hasSeenOwnTurn && input.fieldCardCount === 0
      ? (['firstTurn'] as const)
      : []),
    ...(input.legalMoves?.length === 0 ? (['noLegalMove'] as const) : []),
    ...(input.legalMoves?.some((move) => move.count >= 2)
      ? (['pairAvailable'] as const)
      : []),
    ...(input.fieldCardCount > 0 ? (['followTurn'] as const) : []),
  ];
  return show(
    nextState,
    candidates.find((cue) => !state.shown.includes(cue)),
  );
}
