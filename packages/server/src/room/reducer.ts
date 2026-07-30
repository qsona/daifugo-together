import {
  orderPlayCards,
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
const DEFAULT_INTERIM_MS = 15_000;
const DEFAULT_SET_RESULT_TIMEOUT_MS = 120_000;
const DEFAULT_TURN_LIMIT_MS = 60_000;
const DEFAULT_DISCONNECTED_TURN_LIMIT_MS = 15_000;
const DEFAULT_LOBBY_TTL_MS = 30 * 60_000;
const DEFAULT_ABANDON_TIMEOUT_MS = 5 * 60_000;
const SEATS: SeatId[] = [0, 1, 2, 3];

function rulePort(options: RoomReducerOptions, setId: string) {
  return options.rulePortForSet?.(setId) ?? options.rulePort;
}

function reportRuleIncidents(
  options: RoomReducerOptions,
  setId: string,
  events: readonly (EngineEvent | SetEndedEvent)[],
): void {
  for (const event of events) {
    if (
      event.type !== 'effectRejected' ||
      event.resolution !== 'rejected' ||
      event.detail === undefined
    ) {
      continue;
    }
    options.onRuleIncident?.({
      setId,
      ruleId: event.ruleId,
      type: 'invalid_effect',
      detail: `${String(event.hook)}: ${JSON.stringify(event.detail)}`.slice(
        0,
        4_000,
      ),
    });
  }
}

function reportRuleConflicts(
  options: RoomReducerOptions,
  setId: string,
  gameIndex: number,
  playSeq: number,
  events: readonly (EngineEvent | SetEndedEvent)[],
): void {
  const resolutions = events.filter(
    (
      event,
    ): event is Extract<
      EngineEvent,
      { type: 'effectApplied' | 'effectRejected' }
    > =>
      (event.type === 'effectApplied' || event.type === 'effectRejected') &&
      event.conflictKey !== null,
  );
  const grouped = Map.groupBy(
    resolutions,
    (event) => `${event.hook}\u0000${event.conflictKey ?? ''}`,
  );
  for (const entries of grouped.values()) {
    if (
      entries.length < 2 &&
      entries.every(({ resolution }) => resolution === 'adopted')
    ) {
      continue;
    }
    const first = entries[0];
    if (!first?.conflictKey) continue;
    const adopted =
      entries.find(({ resolution }) => resolution === 'adopted')?.ruleId ??
      entries.find((entry) => 'winnerRuleId' in entry)?.winnerRuleId ??
      first.ruleId;
    options.onRuleConflict?.({
      setId,
      gameIndex,
      playSeq,
      hook: first.hook,
      conflictKey: first.conflictKey,
      adoptedRuleId: adopted,
      entries: structuredClone(entries),
    });
  }
}

export function createRoomState(input: CreateRoomInput): RoomState {
  return {
    roomId: input.roomId,
    inviteCode: input.inviteCode,
    mode: input.mode,
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
    availableRules:
      input.mode === 'basic' ? [] : structuredClone(input.availableRules ?? []),
    fixedRules: null,
    engine: null,
    v: 1,
    turnSeq: 0,
    nextEventSeq: 1,
    setNo: 0,
    turnDeadlineAt: null,
    intermissionEndsAt: null,
    setRespondBy: null,
    lobbyExpiresAt: input.now + (input.lobbyTtlMs ?? DEFAULT_LOBBY_TTL_MS),
    abandonAt: null,
    lastEvents: [],
    firedRuleCounts: {},
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
  const firedRuleCounts = {
    ...(patch.firedRuleCounts ?? state.firedRuleCounts),
  };
  for (const event of events) {
    if (event.t === 'ruleFired') {
      firedRuleCounts[event.ruleId] = (firedRuleCounts[event.ruleId] ?? 0) + 1;
    }
  }
  const nextState: RoomState = {
    ...state,
    ...patch,
    firedRuleCounts,
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
  fixedHumanFirst = false,
): RoomMember[] {
  const ordered = fixedHumanFirst
    ? [
        ...members.filter((member) => !member.isAI),
        ...members.filter((member) => member.isAI),
      ]
    : shuffled(members, random);
  return ordered.map((member, index) => ({
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
  resolveRuleMessage?: RoomReducerOptions['resolveRuleMessage'],
): RoomGameEventPayload[] {
  const output: RoomGameEventPayload[] = [];
  for (const event of events) {
    switch (event.type) {
      case 'played': {
        const seat = seatOf(members, event.player);
        if (seat !== null) {
          output.push({
            t: 'played',
            seat,
            cards: orderPlayCards(event.play),
          });
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
      case 'ruleFired': {
        let message: string | null = null;
        if (event.messageKey !== null) {
          try {
            message =
              resolveRuleMessage?.(
                event.ruleId,
                event.messageKey,
                event.params,
              ) ?? null;
          } catch {
            // 演出文言の解決失敗は権威ゲーム進行へ伝播させない。
          }
        }
        output.push({
          t: 'ruleFired',
          ruleId: event.ruleId,
          name: eventRuleName(rules, event.ruleId),
          message,
          ...(event.messageKey === null
            ? {}
            : { messageKey: event.messageKey }),
        });
        break;
      }
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
  const setNo = state.setNo + 1;
  const setId = `${state.roomId}:set:${setNo}`;
  const availableRules =
    state.mode === 'basic'
      ? []
      : structuredClone(
          input.availableRules ??
            options.availableRulesForSet?.(setId) ??
            state.availableRules,
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
  const members = withSeats(
    [...preparedHumans, ...addedAi],
    random,
    state.mode === 'basic' && preparedHumans.length === 1 && state.setNo === 0,
  );
  const fixedRules = structuredClone(availableRules);
  const started = startSetTransition(
    {
      setId,
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
    rulePort(options, setId),
  );
  reportRuleIncidents(options, setId, started.events);
  reportRuleConflicts(options, setId, 1, state.turnSeq, started.events);
  const settlement = settleMembersAtSetResult(members, started.state);
  const phase = phaseAfterSettlement(started.state, settlement.members);
  return committed(
    state,
    {
      phase,
      members: settlement.members,
      availableRules,
      fixedRules,
      firedRuleCounts: {},
      engine: started.state,
      setNo,
      turnDeadlineAt: deadlineAtForTurn(
        started.state,
        settlement.members,
        state.mode,
        input.now,
        options,
      ),
      intermissionEndsAt:
        started.state.phase.name === 'interimResult'
          ? input.now + started.state.config.interimAutoAdvanceMs
          : null,
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
      ...publicEngineEvents(
        members,
        fixedRules,
        started.events,
        options.resolveRuleMessage,
      ),
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
  mode: RoomState['mode'],
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
  const isBasicSolo =
    mode === 'basic' &&
    members.filter((candidate) => !candidate.isAI && !candidate.departed)
      .length === 1;
  if (member.connected && isBasicSolo) {
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
        intermissionEndsAt: humansRemain ? state.intermissionEndsAt : null,
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
      intermissionEndsAt: humansRemain ? state.intermissionEndsAt : null,
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
    return committed(
      state,
      { phase: 'closed', members: [], intermissionEndsAt: null },
      events,
    );
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
      intermissionEndsAt: null,
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
        ? deadlineAtForTurn(
            state.engine,
            members,
            state.mode,
            action.now,
            options,
          )
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
  const transition = reduceSet(
    state.engine,
    setAction,
    rulePort(options, state.engine.setId),
  );
  reportRuleIncidents(options, state.engine.setId, transition.events);
  reportRuleConflicts(
    options,
    state.engine.setId,
    state.engine.phase.name === 'setResult'
      ? state.engine.results.length
      : state.engine.phase.gameIndex + 1,
    state.turnSeq,
    transition.events,
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
  const settlement = settleMembersAtSetResult(state.members, transition.state);
  const phase = phaseAfterSettlement(transition.state, settlement.members);
  const engineEvents = publicEngineEvents(
    state.members,
    state.fixedRules ?? [],
    transition.events,
    options.resolveRuleMessage,
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
        state.mode,
        action.now,
        options,
      ),
      intermissionEndsAt:
        transition.state.phase.name === 'interimResult'
          ? action.now + transition.state.config.interimAutoAdvanceMs
          : null,
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
    rulePort(options, state.engine.setId),
  );
  reportRuleIncidents(options, state.engine.setId, transition.events);
  reportRuleConflicts(
    options,
    state.engine.setId,
    state.engine.phase.gameIndex + 1,
    state.turnSeq,
    transition.events,
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
      options.resolveRuleMessage,
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
        state.mode,
        action.now,
        options,
      ),
      intermissionEndsAt: null,
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
    rulePort(options, state.engine.setId),
  );
  reportRuleIncidents(options, state.engine.setId, transition.events);
  reportRuleConflicts(
    options,
    state.engine.setId,
    state.engine.phase.name === 'setResult'
      ? state.engine.results.length
      : state.engine.phase.gameIndex + 1,
    state.turnSeq,
    transition.events,
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
      intermissionEndsAt:
        transition.state.phase.name === 'interimResult'
          ? state.intermissionEndsAt
          : null,
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
        options.resolveRuleMessage,
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
    case 'refreshRules':
      return state.phase === 'waiting' && state.mode === 'community'
        ? committed(
            state,
            { availableRules: structuredClone(action.availableRules) },
            [],
          )
        : rejected(state, 'NOT_WAITING');
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
