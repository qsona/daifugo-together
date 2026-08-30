import type {
  BinaryQuizQuestion,
  CardId,
  GameResult,
  RuleChainEntry,
  RuleChainPort,
  RoomErrorCode,
  RoomGameEvent,
  RoomMode,
  RoomPhase,
  SeatId,
  SetState,
} from '@daifugo/core';

export type {
  GameResultView,
  MemberView,
  MultiplayerGameView as GameView,
  PlayerRoomView,
  PublicPlayView,
  RoomErrorCode,
  RoomGameEvent,
  RoomMode,
  RoomPhase,
  RuleRef,
  SeatOption,
  SeatId,
  SetResultView,
} from '@daifugo/core';

export type SeatController = 'human' | 'ai';

export interface RoomMember {
  memberId: string;
  userId: string | null;
  seatId: SeatId | null;
  displayName: string;
  isAI: boolean;
  isHost: boolean;
  connected: boolean;
  controller: SeatController;
  aiActing: boolean;
  departed: boolean;
  wantsNextSet: boolean;
  joinedAt: number;
  disconnectedAt: number | null;
  waitingDisconnectExpiresAt: number | null;
}

export type RoomGameEventPayload = RoomGameEvent extends infer Event
  ? Event extends { seq: number }
    ? Omit<Event, 'seq'>
    : never
  : never;

export interface RoomState {
  roomId: string;
  inviteCode: string;
  mode: RoomMode;
  phase: RoomPhase;
  members: RoomMember[];
  availableRules: RuleChainEntry[];
  fixedRules: RuleChainEntry[] | null;
  engine: SetState | null;
  v: number;
  turnSeq: number;
  nextEventSeq: number;
  setNo: number;
  turnDeadlineAt: number | null;
  intermissionEndsAt: number | null;
  intermissionReadyMemberIds: string[];
  setRespondBy: number | null;
  lobbyExpiresAt: number;
  abandonAt: number | null;
  lastEvents: RoomGameEvent[];
  /** セット内の権威発火回数。client event の再生回数とは独立。 */
  firedRuleCounts: Record<string, number>;
}

export type RoomAction =
  | {
      type: 'refreshRules';
      availableRules: RuleChainEntry[];
    }
  | {
      type: 'join';
      member: {
        memberId: string;
        userId: string;
        displayName: string;
        connected?: boolean;
      };
      now: number;
    }
  | {
      type: 'joinTakeover';
      takeoverMemberId: string;
      user: { userId: string; displayName: string };
      now: number;
    }
  | {
      type: 'start';
      memberId: string;
      now: number;
      setSeed: string;
      availableRules?: RuleChainEntry[];
    }
  | {
      type: 'leave';
      memberId: string;
      now: number;
      setSeed: string;
      availableRules?: RuleChainEntry[];
    }
  | { type: 'disconnect'; memberId: string; now: number }
  | { type: 'reconnect'; memberId: string; now: number }
  | { type: 'rename'; memberId: string; displayName: string }
  | {
      type: 'continue';
      memberId: string;
      now: number;
      setSeed: string;
      availableRules?: RuleChainEntry[];
    }
  | {
      type: 'expireSetResult';
      now: number;
      setSeed: string;
      availableRules?: RuleChainEntry[];
    }
  | {
      type: 'expireWaitingMember';
      memberId: string;
      now: number;
      expectedAt: number;
      setSeed: string;
    }
  | {
      type: 'expireRoom';
      reason: 'lobbyExpired' | 'abandoned';
      now: number;
      expectedAt: number;
    }
  | { type: 'requestDrain'; now: number }
  | {
      type: 'play';
      memberId: string;
      turnSeq: number;
      cards: CardId[];
      now: number;
    }
  | {
      type: 'ruleInput';
      memberId: string;
      turnSeq: number;
      choiceId: string;
      cardIds: CardId[];
      playerId?: never;
      now: number;
    }
  | {
      type: 'ruleInput';
      memberId: string;
      turnSeq: number;
      choiceId: string;
      playerId: string;
      cardIds?: never;
      value?: never;
      now: number;
    }
  | {
      type: 'ruleInput';
      memberId: string;
      turnSeq: number;
      choiceId: string;
      value: number;
      cardIds?: never;
      playerId?: never;
      now: number;
    }
  | { type: 'pass'; memberId: string; turnSeq: number; now: number }
  | {
      type: 'miniGameInput';
      memberId: string;
      miniGameId: string;
      direction?: 'up' | 'down' | 'left' | 'right' | 'stop';
      throwBomb?: boolean;
      round?: number;
      option?: 'a' | 'b';
      now: number;
    }
  | {
      type: 'miniGameTick';
      miniGameId: string;
      question?: BinaryQuizQuestion;
      now: number;
    }
  | {
      type: 'autoAct';
      memberId: string;
      turnSeq: number;
      cards: CardId[] | null;
      reason: 'ai' | 'turnTimeout';
      now: number;
    }
  | { type: 'advanceIntermission'; now: number }
  | { type: 'readyIntermission'; memberId: string; now: number };

export interface RoomTransition {
  state: RoomState;
  events: RoomGameEvent[];
  accepted: boolean;
  error?: {
    code: RoomErrorCode;
    detail?: string;
  };
}

export interface CreateRoomInput {
  roomId: string;
  inviteCode: string;
  mode: RoomMode;
  owner: {
    memberId: string;
    userId: string;
    displayName: string;
  };
  availableRules?: RuleChainEntry[];
  now: number;
  lobbyTtlMs?: number;
}

export interface RoomReducerOptions {
  gamesPerSet?: number;
  interimAutoAdvanceMs?: number;
  setResultTimeoutMs?: number;
  turnLimitMs?: number;
  disconnectedTurnLimitMs?: number;
  lobbyDisconnectGraceMs?: number;
  lobbyTtlMs?: number;
  abandonTimeoutMs?: number;
  random?: () => number;
  createAiMemberId?: (index: number) => string;
  rulePort?: RuleChainPort;
  availableRulesForSet?: (setId: string) => RuleChainEntry[];
  rulePortForSet?: (setId: string) => RuleChainPort;
  resolveRuleMessage?: (
    ruleId: string,
    messageKey: string,
    params?: Readonly<Record<string, string>>,
  ) => string | null;
  releaseRulePort?: (setId: string) => void;
  onRuleIncident?: (incident: {
    setId: string;
    ruleId: string;
    type: 'invalid_effect';
    detail: string;
  }) => void;
  onRuleConflict?: (conflict: {
    setId: string;
    gameIndex: number;
    playSeq: number;
    hook: string;
    conflictKey: string;
    adoptedRuleId: string;
    entries: unknown[];
  }) => void;
}

export type RoomEngineResult = GameResult;
