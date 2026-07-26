import {
  reduceSet,
  startSetTransition,
  type EngineEvent,
  type RuleChainEntry,
  type SetEndedEvent,
  type SetTransition,
} from '@daifugo/core';

import type {
  CreateRoomInput,
  RoomAction,
  RoomErrorCode,
  RoomGameEvent,
  RoomGameEventPayload,
  RoomMember,
  RoomReducerOptions,
  RoomState,
  RoomTransition,
  SeatId,
} from './types.js';

const DEFAULT_GAMES_PER_SET = 3;
const DEFAULT_INTERIM_MS = 5_000;
const DEFAULT_SET_RESULT_TIMEOUT_MS = 120_000;
const SEATS: SeatId[] = [0, 1, 2, 3];

export function createRoomState(input: CreateRoomInput): RoomState {
  return {
    roomId: input.roomId,
    inviteCode: input.inviteCode,
    phase: 'waiting',
    members: [
      {
        memberId: input.owner.memberId,
        userId: input.owner.userId,
        seatId: null,
        displayName: input.owner.displayName,
        isAI: false,
        isHost: true,
        connected: true,
        controller: 'human',
        aiActing: false,
        departed: false,
        wantsNextSet: false,
        joinedAt: input.now,
      },
    ],
    availableRules: structuredClone(input.availableRules ?? []),
    fixedRules: null,
    engine: null,
    v: 1,
    turnSeq: 0,
    nextEventSeq: 1,
    setNo: 0,
    turnDeadlineAt: null,
    setRespondBy: null,
    lastEvents: [],
  };
}

function rejected(
  state: RoomState,
  code: RoomErrorCode,
  detail?: string,
): RoomTransition {
  return {
    state,
    events: [],
    accepted: false,
    error: detail === undefined ? { code } : { code, detail },
  };
}

function numberedEvents(
  state: RoomState,
  events: RoomGameEventPayload[],
): { events: RoomGameEvent[]; nextEventSeq: number } {
  let seq = state.nextEventSeq;
  const numbered = events.map((event) => ({ ...event, seq: seq++ })) as
    RoomGameEvent[] | never;
  return { events: numbered, nextEventSeq: seq };
}

function committed(
  state: RoomState,
  patch: Partial<RoomState>,
  events: RoomGameEventPayload[],
): RoomTransition {
  const numbered = numberedEvents(state, events);
  const nextState: RoomState = {
    ...state,
    ...patch,
    v: state.v + 1,
    nextEventSeq: numbered.nextEventSeq,
    lastEvents: numbered.events,
  };
  return {
    state: nextState,
    events: numbered.events,
    accepted: true,
  };
}

function memberSeat(
  members: readonly RoomMember[],
  memberId: string,
): SeatId | null {
  return members.find((member) => member.memberId === memberId)?.seatId ?? null;
}

function seatOf(
  members: readonly RoomMember[],
  memberId: string,
): SeatId | null {
  return memberSeat(members, memberId);
}

function safeSample(random: () => number): number {
  try {
    const sample = random();
    return Number.isFinite(sample) ? Math.max(0, Math.min(1, sample)) : 0.5;
  } catch {
    return 0.5;
  }
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.min(
      index,
      Math.floor(safeSample(random) * (index + 1)),
    );
    [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
  }
  return result;
}

function aiMembers(
  state: RoomState,
  count: number,
  options: RoomReducerOptions,
  now: number,
): RoomMember[] {
  const createId =
    options.createAiMemberId ??
    ((index: number) => `${state.roomId}:ai:${state.setNo + 1}:${index + 1}`);
  return Array.from({ length: count }, (_, index) => ({
    memberId: createId(index),
    userId: null,
    seatId: null,
    displayName: `AIプレイヤー${String.fromCharCode(65 + index)}`,
    isAI: true,
    isHost: false,
    connected: true,
    controller: 'ai',
    aiActing: false,
    departed: false,
    wantsNextSet: true,
    joinedAt: now + index,
  }));
}

function withSeats(
  members: readonly RoomMember[],
  random: () => number,
): RoomMember[] {
  return shuffled(members, random).map((member, index) => ({
    ...member,
    seatId: SEATS[index]!,
  }));
}

function eventRuleName(
  rules: readonly RuleChainEntry[],
  ruleId: string,
): string {
  return rules.find((rule) => rule.ruleId === ruleId)?.name ?? ruleId;
}

function publicEngineEvents(
  members: readonly RoomMember[],
  rules: readonly RuleChainEntry[],
  events: readonly (EngineEvent | SetEndedEvent)[],
): RoomGameEventPayload[] {
  const output: RoomGameEventPayload[] = [];
  for (const event of events) {
    switch (event.type) {
      case 'played': {
        const seat = seatOf(members, event.player);
        if (seat !== null) {
          output.push({ t: 'played', seat, cards: event.play.cards });
        }
        break;
      }
      case 'passed': {
        const seat = seatOf(members, event.player);
        if (seat !== null) {
          output.push({ t: 'passed', seat });
        }
        break;
      }
      case 'fieldCleared':
        output.push({ t: 'fieldCleared', reason: event.reason });
        break;
      case 'playerFinished': {
        const seat = seatOf(members, event.player);
        if (seat !== null) {
          output.push({
            t: 'playerFinished',
            seat,
            rank: event.standing,
          });
        }
        break;
      }
      case 'gameEnded':
        output.push({ t: 'gameEnded' });
        break;
      case 'setEnded':
        output.push({ t: 'setEnded' });
        break;
      case 'ruleFired':
        output.push({
          t: 'ruleFired',
          ruleId: event.ruleId,
          name: eventRuleName(rules, event.ruleId),
          messageKey: event.messageKey,
        });
        break;
      case 'gameStarted':
      case 'turnChanged':
      case 'failsafe':
      case 'playerRetired':
      case 'cardsMoved':
      case 'effectApplied':
      case 'effectRejected':
        break;
    }
  }
  return output;
}

function phaseFromEngine(engine: SetTransition['state']): RoomState['phase'] {
  return engine.phase.name === 'setResult' ? 'setResult' : 'playing';
}

function join(state: RoomState, action: Extract<RoomAction, { type: 'join' }>) {
  if (state.phase === 'closed') {
    return rejected(state, 'ROOM_CLOSED');
  }
  if (state.phase !== 'waiting') {
    return rejected(state, 'NOT_WAITING');
  }
  if (
    state.members.some(
      (member) =>
        member.userId === action.member.userId ||
        member.memberId === action.member.memberId,
    )
  ) {
    return rejected(state, 'ALREADY_IN_ROOM');
  }
  if (state.members.filter((member) => !member.isAI).length >= 4) {
    return rejected(state, 'ROOM_FULL');
  }
  const member: RoomMember = {
    memberId: action.member.memberId,
    userId: action.member.userId,
    seatId: null,
    displayName: action.member.displayName,
    isAI: false,
    isHost: false,
    connected: action.member.connected ?? true,
    controller: 'human',
    aiActing: false,
    departed: false,
    wantsNextSet: false,
    joinedAt: action.now,
  };
  return committed(state, { members: [...state.members, member] }, [
    { t: 'memberJoined', memberId: member.memberId },
  ]);
}

function start(
  state: RoomState,
  action: Extract<RoomAction, { type: 'start' }>,
  options: RoomReducerOptions,
): RoomTransition {
  if (state.phase !== 'waiting') {
    return rejected(state, 'NOT_WAITING');
  }
  const actor = state.members.find(
    (member) => member.memberId === action.memberId,
  );
  if (!actor) {
    return rejected(state, 'NOT_IN_ROOM');
  }
  if (!actor.isHost) {
    return rejected(state, 'NOT_HOST');
  }
  const humans = state.members.filter(
    (member) => !member.isAI && !member.departed,
  );
  const addedAi = aiMembers(state, 4 - humans.length, options, action.now);
  const random = options.random ?? Math.random;
  const members = withSeats([...humans, ...addedAi], random);
  const fixedRules = structuredClone(state.availableRules);
  const setNo = state.setNo + 1;
  const started = startSetTransition({
    setId: `${state.roomId}:set:${setNo}`,
    config: {
      gamesPerSet: options.gamesPerSet ?? DEFAULT_GAMES_PER_SET,
      interimAutoAdvanceMs: options.interimAutoAdvanceMs ?? DEFAULT_INTERIM_MS,
    },
    members: members.map((member) => ({
      id: member.memberId,
      displayName: member.displayName,
      isAI: member.isAI,
    })),
    ruleChain: fixedRules,
    setSeed: action.setSeed,
  });
  const initialEvents: RoomGameEventPayload[] = [
    ...addedAi.map((member) => ({
      t: 'aiFilled' as const,
      memberId: member.memberId,
    })),
    { t: 'setStarted', setNo },
    { t: 'gameStarted', gameNo: 1 },
    ...publicEngineEvents(members, fixedRules, started.events),
  ];
  return committed(
    state,
    {
      phase: phaseFromEngine(started.state),
      members,
      fixedRules,
      engine: started.state,
      setNo,
      turnDeadlineAt: null,
      setRespondBy:
        started.state.phase.name === 'setResult'
          ? action.now +
            (options.setResultTimeoutMs ?? DEFAULT_SET_RESULT_TIMEOUT_MS)
          : null,
    },
    initialEvents,
  );
}

function gameAction(
  state: RoomState,
  action: Extract<RoomAction, { type: 'play' | 'pass' }>,
  options: RoomReducerOptions,
): RoomTransition {
  if (state.phase !== 'playing' || !state.engine) {
    return rejected(state, 'NOT_PLAYING');
  }
  const currentPlayer = state.engine.currentGame?.public.turn;
  const actor = state.members.find(
    (member) => member.memberId === action.memberId,
  );
  if (!actor || actor.seatId === null || currentPlayer !== actor.memberId) {
    return rejected(state, 'NOT_YOUR_TURN');
  }
  if (action.turnSeq !== state.turnSeq) {
    return rejected(state, 'STALE_TURN');
  }
  const transition = reduceSet(
    state.engine,
    action.type === 'play'
      ? { type: 'play', player: actor.memberId, cards: action.cards }
      : { type: 'pass', player: actor.memberId },
  );
  if (
    transition.rejections.length > 0 ||
    transition.acceptedAction === undefined
  ) {
    return rejected(
      state,
      'ILLEGAL_PLAY',
      transition.rejections
        .map((rejection) =>
          'code' in rejection ? rejection.code : 'ILLEGAL_PLAY',
        )
        .join(','),
    );
  }
  const phase = phaseFromEngine(transition.state);
  const engineEvents = publicEngineEvents(
    state.members,
    state.fixedRules ?? [],
    transition.events,
  );
  return committed(
    state,
    {
      phase,
      engine: transition.state,
      turnSeq: state.turnSeq + 1,
      turnDeadlineAt: null,
      setRespondBy:
        phase === 'setResult'
          ? action.now +
            (options.setResultTimeoutMs ?? DEFAULT_SET_RESULT_TIMEOUT_MS)
          : null,
    },
    engineEvents,
  );
}

function advanceIntermission(state: RoomState): RoomTransition {
  if (
    state.phase !== 'playing' ||
    !state.engine ||
    state.engine.phase.name !== 'interimResult'
  ) {
    return rejected(state, 'INVALID_SET_PHASE');
  }
  const transition = reduceSet(state.engine, { type: 'advance' });
  if (transition.rejections.length > 0) {
    return rejected(state, 'INVALID_SET_PHASE');
  }
  const gameNo =
    transition.state.phase.name === 'gameInProgress'
      ? transition.state.phase.gameIndex + 1
      : state.engine.results.length + 1;
  return committed(state, { engine: transition.state }, [
    { t: 'gameStarted', gameNo },
    ...publicEngineEvents(
      state.members,
      state.fixedRules ?? [],
      transition.events,
    ),
  ]);
}

export function reduceRoom(
  state: RoomState,
  action: RoomAction,
  options: RoomReducerOptions = {},
): RoomTransition {
  switch (action.type) {
    case 'join':
      return join(state, action);
    case 'start':
      return start(state, action, options);
    case 'play':
    case 'pass':
      return gameAction(state, action, options);
    case 'advanceIntermission':
      return advanceIntermission(state);
  }
}
