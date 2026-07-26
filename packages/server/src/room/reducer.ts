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
const DEFAULT_TURN_LIMIT_MS = 60_000;
const DEFAULT_DISCONNECTED_TURN_LIMIT_MS = 15_000;
const DEFAULT_LOBBY_TTL_MS = 30 * 60_000;
const DEFAULT_ABANDON_TIMEOUT_MS = 5 * 60_000;
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
        disconnectedAt: null,
        waitingDisconnectExpiresAt: null,
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
    lobbyExpiresAt: input.now + (input.lobbyTtlMs ?? DEFAULT_LOBBY_TTL_MS),
    abandonAt: null,
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
  const numbered = structuredClone(
    events.map((event) => ({ ...event, seq: seq++ })),
  ) as RoomGameEvent[];
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
    lastEvents: structuredClone(numbered.events),
  };
  return {
    state: nextState,
    events: structuredClone(numbered.events),
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
    disconnectedAt: null,
    waitingDisconnectExpiresAt: null,
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

function settleMembersAtSetResult(
  members: readonly RoomMember[],
  engine: SetTransition['state'],
): { members: RoomMember[]; removedMemberIds: string[] } {
  if (engine.phase.name !== 'setResult') {
    return { members: [...members], removedMemberIds: [] };
  }
  const removedMemberIds = members
    .filter((member) => !member.isAI && (member.departed || !member.connected))
    .map((member) => member.memberId);
  return {
    members: members.filter(
      (member) => member.isAI || (!member.departed && member.connected),
    ),
    removedMemberIds,
  };
}

function memberLeftEvents(
  removedMemberIds: readonly string[],
): RoomGameEventPayload[] {
  return removedMemberIds.map((memberId) => ({
    t: 'memberLeft',
    memberId,
  }));
}

function startSet(
  state: RoomState,
  humans: readonly RoomMember[],
  input: {
    now: number;
    setSeed: string;
    availableRules?: RuleChainEntry[];
  },
  options: RoomReducerOptions,
  leadingEvents: RoomGameEventPayload[] = [],
): RoomTransition {
  const availableRules = structuredClone(
    input.availableRules ?? state.availableRules,
  );
  const preparedHumans = humans.map((member) =>
    member.connected
      ? {
          ...member,
          seatId: null,
          controller: 'human' as const,
          aiActing: false,
          wantsNextSet: false,
          disconnectedAt: null,
          waitingDisconnectExpiresAt: null,
        }
      : {
          ...member,
          seatId: null,
          controller: 'ai' as const,
          aiActing: true,
          wantsNextSet: false,
          waitingDisconnectExpiresAt: null,
        },
  );
  const addedAi = aiMembers(
    state,
    4 - preparedHumans.length,
    options,
    input.now,
  );
  const random = options.random ?? Math.random;
  const members = withSeats([...preparedHumans, ...addedAi], random);
  const fixedRules = structuredClone(availableRules);
  const setNo = state.setNo + 1;
  const started = startSetTransition(
    {
      setId: `${state.roomId}:set:${setNo}`,
      config: {
        gamesPerSet: options.gamesPerSet ?? DEFAULT_GAMES_PER_SET,
        interimAutoAdvanceMs:
          options.interimAutoAdvanceMs ?? DEFAULT_INTERIM_MS,
      },
      members: members.map((member) => ({
        id: member.memberId,
        displayName: member.displayName,
        isAI: member.isAI,
      })),
      ruleChain: fixedRules,
      setSeed: input.setSeed,
    },
    options.rulePort,
  );
  const settlement = settleMembersAtSetResult(members, started.state);
  const phase = phaseAfterSettlement(started.state, settlement.members);
  return committed(
    state,
    {
      phase,
      members: settlement.members,
      availableRules,
      fixedRules,
      engine: started.state,
      setNo,
      turnDeadlineAt: deadlineAtForTurn(
        started.state,
        settlement.members,
        input.now,
        options,
      ),
      abandonAt: null,
      setRespondBy:
        phase === 'setResult'
          ? input.now +
            (options.setResultTimeoutMs ?? DEFAULT_SET_RESULT_TIMEOUT_MS)
          : null,
    },
    [
      ...leadingEvents,
      ...addedAi.map((member) => ({
        t: 'aiFilled' as const,
        memberId: member.memberId,
      })),
      { t: 'setStarted', setNo },
      { t: 'gameStarted', gameNo: 1 },
      ...publicEngineEvents(members, fixedRules, started.events),
      ...memberLeftEvents(settlement.removedMemberIds),
    ],
  );
}

function phaseAfterSettlement(
  engine: SetTransition['state'],
  members: readonly RoomMember[],
): RoomState['phase'] {
  const phase = phaseFromEngine(engine);
  return phase === 'setResult' &&
    !members.some((member) => !member.isAI && !member.departed)
    ? 'closed'
    : phase;
}

function deadlineAtForTurn(
  engine: SetTransition['state'],
  members: readonly RoomMember[],
  now: number,
  options: RoomReducerOptions,
): number | null {
  if (
    engine.phase.name !== 'gameInProgress' ||
    engine.currentGame?.public.phase !== 'awaitingPlay'
  ) {
    return null;
  }
  const member = members.find(
    (candidate) => candidate.memberId === engine.currentGame?.public.turn,
  );
  if (!member || member.isAI || member.departed) {
    return null;
  }
  return (
    now +
    (member.connected
      ? (options.turnLimitMs ?? DEFAULT_TURN_LIMIT_MS)
      : (options.disconnectedTurnLimitMs ?? DEFAULT_DISCONNECTED_TURN_LIMIT_MS))
  );
}

function join(
  state: RoomState,
  action: Extract<RoomAction, { type: 'join' }>,
  options: RoomReducerOptions,
) {
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
    disconnectedAt: action.member.connected === false ? action.now : null,
    waitingDisconnectExpiresAt:
      action.member.connected === false
        ? action.now + (options.lobbyDisconnectGraceMs ?? 60_000)
        : null,
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
  return startSet(
    state,
    state.members.filter((member) => !member.isAI && !member.departed),
    action,
    options,
  );
}

function continueSet(
  state: RoomState,
  action: Extract<RoomAction, { type: 'continue' }>,
  options: RoomReducerOptions,
): RoomTransition {
  if (state.phase !== 'setResult') {
    return rejected(state, 'NOT_SET_RESULT');
  }
  const actor = state.members.find(
    (member) =>
      member.memberId === action.memberId &&
      !member.isAI &&
      !member.departed &&
      member.connected,
  );
  if (!actor) {
    return rejected(state, 'NOT_IN_ROOM');
  }
  if (actor.wantsNextSet) {
    return { state, events: [], accepted: true };
  }
  const members = state.members.map((member) =>
    member.memberId === actor.memberId
      ? { ...member, wantsNextSet: true }
      : member,
  );
  const humans = members.filter(
    (member) => !member.isAI && !member.departed && member.connected,
  );
  if (humans.every((member) => member.wantsNextSet)) {
    return startSet(state, humans, action, options);
  }
  return committed(state, { members }, []);
}

function leave(
  state: RoomState,
  action: Extract<RoomAction, { type: 'leave' }>,
  options: RoomReducerOptions,
): RoomTransition {
  const leaving = state.members.find(
    (member) => member.memberId === action.memberId && !member.isAI,
  );
  if (!leaving) {
    return rejected(state, 'NOT_IN_ROOM');
  }
  if (state.phase === 'closed') {
    return rejected(state, 'ROOM_CLOSED');
  }
  if (state.phase === 'playing') {
    const members = state.members.map((member) =>
      member.memberId === leaving.memberId
        ? {
            ...member,
            connected: false,
            controller: 'ai' as const,
            aiActing: true,
            departed: true,
          }
        : member,
    );
    const humansRemain = members.some(
      (member) => !member.isAI && !member.departed,
    );
    const connectedHumansRemain = members.some(
      (member) => !member.isAI && !member.departed && member.connected,
    );
    return committed(
      state,
      {
        phase: humansRemain ? state.phase : 'closed',
        members,
        abandonAt:
          humansRemain && !connectedHumansRemain
            ? action.now +
              (options.abandonTimeoutMs ?? DEFAULT_ABANDON_TIMEOUT_MS)
            : null,
      },
      [
        { t: 'memberLeft', memberId: leaving.memberId },
        { t: 'aiTakeover', memberId: leaving.memberId },
      ],
    );
  }

  const members = state.members.filter(
    (member) => member.memberId !== leaving.memberId,
  );
  const nextHost = leaving.isHost
    ? members
        .filter((member) => !member.isAI && !member.departed)
        .sort((left, right) => left.joinedAt - right.joinedAt)[0]
    : undefined;
  const withHost = nextHost
    ? members.map((member) => ({
        ...member,
        isHost: member.memberId === nextHost.memberId,
      }))
    : members;
  const humansRemain = withHost.some(
    (member) => !member.isAI && !member.departed,
  );
  const events: RoomGameEventPayload[] = [
    { t: 'memberLeft', memberId: leaving.memberId },
  ];
  if (nextHost) {
    events.push({ t: 'hostChanged', memberId: nextHost.memberId });
  }
  const remainingHumans = withHost.filter(
    (member) => !member.isAI && !member.departed && member.connected,
  );
  if (
    state.phase === 'setResult' &&
    remainingHumans.length > 0 &&
    remainingHumans.every((member) => member.wantsNextSet)
  ) {
    return startSet(
      { ...state, members: withHost },
      remainingHumans,
      {
        now: action.now,
        setSeed: action.setSeed,
        ...(action.availableRules === undefined
          ? {}
          : { availableRules: action.availableRules }),
      },
      options,
      events,
    );
  }
  return committed(
    state,
    {
      phase: humansRemain ? state.phase : 'closed',
      members: withHost,
    },
    events,
  );
}

function expireSetResult(
  state: RoomState,
  action: Extract<RoomAction, { type: 'expireSetResult' }>,
  options: RoomReducerOptions,
): RoomTransition {
  if (state.phase !== 'setResult') {
    return rejected(state, 'NOT_SET_RESULT');
  }
  if (state.setRespondBy !== null && action.now < state.setRespondBy) {
    return rejected(state, 'INVALID_SET_PHASE');
  }
  const continuing = state.members.filter(
    (member) =>
      !member.isAI &&
      !member.departed &&
      member.connected &&
      member.wantsNextSet,
  );
  const continuingIds = new Set(continuing.map((member) => member.memberId));
  const removedIds = state.members.flatMap((member) =>
    !member.isAI && !continuingIds.has(member.memberId)
      ? [member.memberId]
      : [],
  );
  const events = memberLeftEvents(removedIds);
  if (continuing.length === 0) {
    return committed(state, { phase: 'closed', members: [] }, events);
  }
  return startSet(
    { ...state, members: continuing },
    continuing,
    action,
    options,
    events,
  );
}

function expireWaitingMember(
  state: RoomState,
  action: Extract<RoomAction, { type: 'expireWaitingMember' }>,
  options: RoomReducerOptions,
): RoomTransition {
  if (state.phase !== 'waiting') {
    return rejected(state, 'NOT_WAITING');
  }
  const member = state.members.find(
    (candidate) =>
      candidate.memberId === action.memberId &&
      !candidate.isAI &&
      !candidate.connected &&
      candidate.waitingDisconnectExpiresAt === action.expectedAt,
  );
  if (!member || action.now < action.expectedAt) {
    return rejected(state, 'INVALID_SET_PHASE');
  }
  return leave(
    state,
    {
      type: 'leave',
      memberId: member.memberId,
      now: action.now,
      setSeed: action.setSeed,
    },
    options,
  );
}

function expireRoom(
  state: RoomState,
  action: Extract<RoomAction, { type: 'expireRoom' }>,
): RoomTransition {
  const validLobbyExpiry =
    action.reason === 'lobbyExpired' &&
    state.phase === 'waiting' &&
    state.lobbyExpiresAt === action.expectedAt;
  const validAbandonExpiry =
    action.reason === 'abandoned' &&
    state.phase === 'playing' &&
    state.abandonAt === action.expectedAt &&
    !state.members.some(
      (member) => !member.isAI && !member.departed && member.connected,
    );
  if (
    action.now < action.expectedAt ||
    (!validLobbyExpiry && !validAbandonExpiry)
  ) {
    return rejected(state, 'INVALID_SET_PHASE');
  }
  return committed(
    state,
    {
      phase: 'closed',
      members: [],
      turnDeadlineAt: null,
      setRespondBy: null,
      abandonAt: null,
    },
    memberLeftEvents(
      state.members.flatMap((member) => (member.isAI ? [] : [member.memberId])),
    ),
  );
}

function connectionChanged(
  state: RoomState,
  action: Extract<RoomAction, { type: 'disconnect' | 'reconnect' }>,
  options: RoomReducerOptions,
): RoomTransition {
  if (state.phase === 'closed') {
    return rejected(state, 'ROOM_CLOSED');
  }
  const member = state.members.find(
    (candidate) => candidate.memberId === action.memberId && !candidate.isAI,
  );
  if (!member || member.departed) {
    return rejected(state, 'NOT_IN_ROOM');
  }
  const reconnecting = action.type === 'reconnect';
  if (member.connected === reconnecting) {
    return rejected(state, 'ALREADY_IN_ROOM');
  }
  const aiActing = !reconnecting && state.phase !== 'waiting';
  const members = state.members.map((candidate) =>
    candidate.memberId === member.memberId
      ? {
          ...candidate,
          connected: reconnecting,
          controller: aiActing ? ('ai' as const) : ('human' as const),
          aiActing,
          disconnectedAt: reconnecting ? null : action.now,
          waitingDisconnectExpiresAt:
            !reconnecting && state.phase === 'waiting'
              ? action.now + (options.lobbyDisconnectGraceMs ?? 60_000)
              : null,
        }
      : candidate,
  );
  const connectedHumans = members.filter(
    (candidate) =>
      !candidate.isAI && !candidate.departed && candidate.connected,
  );
  const abandonAt =
    state.phase === 'playing' && connectedHumans.length === 0
      ? (state.abandonAt ??
        action.now + (options.abandonTimeoutMs ?? DEFAULT_ABANDON_TIMEOUT_MS))
      : null;
  return committed(
    state,
    {
      members,
      turnDeadlineAt: state.engine
        ? deadlineAtForTurn(state.engine, members, action.now, options)
        : null,
      abandonAt,
    },
    [
      {
        t: reconnecting ? 'memberReconnected' : 'memberDisconnected',
        memberId: member.memberId,
      },
      ...(aiActing
        ? ([{ t: 'aiTakeover', memberId: member.memberId }] as const)
        : state.phase !== 'waiting'
          ? ([{ t: 'humanReturned', memberId: member.memberId }] as const)
          : []),
    ],
  );
}

function rename(
  state: RoomState,
  action: Extract<RoomAction, { type: 'rename' }>,
): RoomTransition {
  if (state.phase === 'closed') {
    return rejected(state, 'ROOM_CLOSED');
  }
  const member = state.members.find(
    (candidate) =>
      candidate.memberId === action.memberId &&
      !candidate.isAI &&
      !candidate.departed,
  );
  if (!member) {
    return rejected(state, 'NOT_IN_ROOM');
  }
  const displayName = action.displayName.trim();
  if (
    displayName.length < 1 ||
    [...displayName].length > 10 ||
    [...displayName].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || code === 127;
    })
  ) {
    return rejected(state, 'INVALID_NAME');
  }
  return committed(
    state,
    {
      members: state.members.map((candidate) =>
        candidate.memberId === member.memberId
          ? { ...candidate, displayName }
          : candidate,
      ),
    },
    [],
  );
}

function gameAction(
  state: RoomState,
  action: Extract<RoomAction, { type: 'play' | 'pass' | 'autoAct' }>,
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
  const setAction: Parameters<typeof reduceSet>[1] =
    action.type === 'play'
      ? { type: 'play', player: actor.memberId, cards: action.cards }
      : action.type === 'autoAct' && action.cards !== null
        ? { type: 'play', player: actor.memberId, cards: action.cards }
        : { type: 'pass', player: actor.memberId };
  const transition = reduceSet(state.engine, setAction, options.rulePort);
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
  const settlement = settleMembersAtSetResult(state.members, transition.state);
  const phase = phaseAfterSettlement(transition.state, settlement.members);
  const engineEvents = publicEngineEvents(
    state.members,
    state.fixedRules ?? [],
    transition.events,
  );
  if (action.type === 'autoAct' && action.reason === 'turnTimeout') {
    engineEvents.unshift({ t: 'turnTimeout', seat: actor.seatId });
  }
  engineEvents.push(...memberLeftEvents(settlement.removedMemberIds));
  return committed(
    state,
    {
      phase,
      members: settlement.members,
      engine: transition.state,
      turnSeq: state.turnSeq + 1,
      turnDeadlineAt: deadlineAtForTurn(
        transition.state,
        settlement.members,
        action.now,
        options,
      ),
      setRespondBy:
        phase === 'setResult'
          ? action.now +
            (options.setResultTimeoutMs ?? DEFAULT_SET_RESULT_TIMEOUT_MS)
          : null,
      abandonAt: phase === 'playing' ? state.abandonAt : null,
    },
    engineEvents,
  );
}

function advanceIntermission(
  state: RoomState,
  action: Extract<RoomAction, { type: 'advanceIntermission' }>,
  options: RoomReducerOptions,
): RoomTransition {
  if (
    state.phase !== 'playing' ||
    !state.engine ||
    state.engine.phase.name !== 'interimResult'
  ) {
    return rejected(state, 'INVALID_SET_PHASE');
  }
  const transition = reduceSet(
    state.engine,
    { type: 'advance' },
    options.rulePort,
  );
  if (transition.rejections.length > 0) {
    return rejected(state, 'INVALID_SET_PHASE');
  }
  const gameNo =
    transition.state.phase.name === 'gameInProgress'
      ? transition.state.phase.gameIndex + 1
      : state.engine.results.length + 1;
  const settlement = settleMembersAtSetResult(state.members, transition.state);
  const phase = phaseAfterSettlement(transition.state, settlement.members);
  const events: RoomGameEventPayload[] = [
    { t: 'gameStarted', gameNo },
    ...publicEngineEvents(
      state.members,
      state.fixedRules ?? [],
      transition.events,
    ),
    ...memberLeftEvents(settlement.removedMemberIds),
  ];
  return committed(
    state,
    {
      phase,
      members: settlement.members,
      engine: transition.state,
      turnDeadlineAt: deadlineAtForTurn(
        transition.state,
        settlement.members,
        action.now,
        options,
      ),
      setRespondBy:
        phase === 'setResult'
          ? action.now +
            (options.setResultTimeoutMs ?? DEFAULT_SET_RESULT_TIMEOUT_MS)
          : null,
      abandonAt: phase === 'playing' ? state.abandonAt : null,
    },
    events,
  );
}

function requestDrain(
  state: RoomState,
  action: Extract<RoomAction, { type: 'requestDrain' }>,
  options: RoomReducerOptions,
): RoomTransition {
  if (state.phase !== 'playing' || !state.engine) {
    return rejected(state, 'NOT_PLAYING');
  }
  const transition = reduceSet(
    state.engine,
    { type: 'requestDrain' },
    options.rulePort,
  );
  if (
    transition.rejections.length > 0 ||
    transition.acceptedAction === undefined
  ) {
    return rejected(state, 'INVALID_SET_PHASE');
  }
  const settlement = settleMembersAtSetResult(state.members, transition.state);
  const phase = phaseAfterSettlement(transition.state, settlement.members);
  return committed(
    state,
    {
      phase,
      members: settlement.members,
      engine: transition.state,
      turnDeadlineAt: phase === 'playing' ? state.turnDeadlineAt : null,
      setRespondBy:
        phase === 'setResult'
          ? action.now +
            (options.setResultTimeoutMs ?? DEFAULT_SET_RESULT_TIMEOUT_MS)
          : null,
      abandonAt: phase === 'playing' ? state.abandonAt : null,
    },
    [
      ...publicEngineEvents(
        state.members,
        state.fixedRules ?? [],
        transition.events,
      ),
      ...memberLeftEvents(settlement.removedMemberIds),
    ],
  );
}

export function reduceRoom(
  state: RoomState,
  action: RoomAction,
  options: RoomReducerOptions = {},
): RoomTransition {
  switch (action.type) {
    case 'join':
      return join(state, action, options);
    case 'start':
      return start(state, action, options);
    case 'leave':
      return leave(state, action, options);
    case 'disconnect':
    case 'reconnect':
      return connectionChanged(state, action, options);
    case 'rename':
      return rename(state, action);
    case 'continue':
      return continueSet(state, action, options);
    case 'expireSetResult':
      return expireSetResult(state, action, options);
    case 'expireWaitingMember':
      return expireWaitingMember(state, action, options);
    case 'expireRoom':
      return expireRoom(state, action);
    case 'play':
    case 'pass':
    case 'autoAct':
      return gameAction(state, action, options);
    case 'advanceIntermission':
      return advanceIntermission(state, action, options);
    case 'requestDrain':
      return requestDrain(state, action, options);
  }
}
