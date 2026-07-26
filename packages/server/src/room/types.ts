import type {
  CardId,
  GameResult,
  RuleChainEntry,
  RuleChainPort,
  RoomErrorCode,
  RoomGameEvent,
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
  RoomPhase,
  RuleRef,
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
  setRespondBy: number | null;
  lobbyExpiresAt: number;
  abandonAt: number | null;
  lastEvents: RoomGameEvent[];
}

export type RoomAction =
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
  | { type: 'start'; memberId: string; now: number; setSeed: string }
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
  | {
      type: 'play';
      memberId: string;
      turnSeq: number;
      cards: CardId[];
      now: number;
    }
  | { type: 'pass'; memberId: string; turnSeq: number; now: number }
  | {
      type: 'autoAct';
      memberId: string;
      turnSeq: number;
      cards: CardId[] | null;
      reason: 'ai' | 'turnTimeout';
      now: number;
    }
  | { type: 'advanceIntermission'; now: number };

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
}

export type RoomEngineResult = GameResult;
