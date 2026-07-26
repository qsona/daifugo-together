import type {
  Card,
  CardId,
  GameResult,
  Play,
  RuleChainEntry,
  SetState,
  Standing,
  Title,
} from '@daifugo/core';

export type SeatId = 0 | 1 | 2 | 3;
export type RoomPhase = 'waiting' | 'playing' | 'setResult' | 'closed';
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
}

export interface RuleRef {
  ruleId: string;
  name: string;
}

export type RoomGameEvent = { seq: number } & (
  | {
      t:
        | 'memberJoined'
        | 'memberLeft'
        | 'memberDisconnected'
        | 'memberReconnected'
        | 'hostChanged'
        | 'aiFilled'
        | 'aiTakeover'
        | 'humanReturned';
      memberId: string;
    }
  | { t: 'setStarted'; setNo: number }
  | { t: 'gameStarted'; gameNo: number }
  | { t: 'played'; seat: SeatId; cards: Card[] }
  | { t: 'passed'; seat: SeatId }
  | { t: 'turnTimeout'; seat: SeatId }
  | { t: 'fieldCleared'; reason: 'allPassed' | 'rule' }
  | { t: 'playerFinished'; seat: SeatId; rank: number }
  | { t: 'gameEnded' }
  | { t: 'setEnded' }
  | {
      t: 'ruleFired';
      ruleId: string;
      name: string;
      messageKey: string;
    }
);

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
  | { type: 'leave'; memberId: string }
  | { type: 'disconnect'; memberId: string }
  | { type: 'reconnect'; memberId: string }
  | {
      type: 'play';
      memberId: string;
      turnSeq: number;
      cards: CardId[];
      now: number;
    }
  | { type: 'pass'; memberId: string; turnSeq: number; now: number }
  | { type: 'advanceIntermission' };

export type RoomErrorCode =
  | 'ALREADY_IN_ROOM'
  | 'ROOM_FULL'
  | 'ROOM_CLOSED'
  | 'NOT_IN_ROOM'
  | 'NOT_HOST'
  | 'NOT_WAITING'
  | 'NOT_PLAYING'
  | 'NOT_YOUR_TURN'
  | 'STALE_TURN'
  | 'ILLEGAL_PLAY'
  | 'INVALID_SET_PHASE';

export interface RoomTransition {
  state: RoomState;
  events: RoomGameEvent[];
  accepted: boolean;
  error?: {
    code: RoomErrorCode;
    detail?: string;
  };
}

export interface MemberView {
  memberId: string;
  seatId: SeatId | null;
  displayName: string;
  isAI: boolean;
  isHost: boolean;
  connected: boolean;
  aiActing: boolean;
  departed: boolean;
  handCount: number | null;
  finishedRank: number | null;
  wantsNextSet: boolean | null;
}

export type PublicPlayView =
  | { t: 'gameStarted'; firstSeat: SeatId; handCounts: number[] }
  | { t: 'played'; seat: SeatId; cards: Card[]; kind: Play['kind'] }
  | { t: 'passed'; seat: SeatId }
  | {
      t: 'fieldCleared';
      reason: 'allPassed' | 'rule';
      nextLeaderSeat: SeatId;
    }
  | { t: 'turnChanged'; seat: SeatId }
  | { t: 'playerFinished'; seat: SeatId; rank: Standing; title: Title }
  | {
      t: 'gameEnded';
      standings: { seat: SeatId; rank: Standing; title: Title }[];
    }
  | { t: 'ruleFired'; ruleId: string; messageKey: string }
  | { t: 'failsafe'; reason: 'leadNoLegalMove' | 'turnLimit' }
  | { t: 'playerRetired'; seat: SeatId; cardCount: number; rank: Standing }
  | { t: 'cardsMoved'; count: number };

export interface GameResultView {
  gameNo: number;
  standings: { seat: SeatId; rank: Standing; title: Title }[];
  firedRuleIds: string[];
}

export interface GameView {
  gameNo: number;
  status: 'playing' | 'intermission';
  field: {
    cards: Card[];
    playedBySeat: SeatId | null;
    passedSeats: SeatId[];
  };
  turn: {
    seat: SeatId;
    turnSeq: number;
    deadlineAt: number | null;
  } | null;
  history: PublicPlayView[];
  previousResults: GameResultView[];
  yourHand: Card[];
  legalPlays?: CardId[][];
}

export interface SetResultView {
  standings: {
    memberId: string;
    totalRank: number;
    title: string;
    ranks: number[];
  }[];
  respondBy: number;
}

export interface PlayerRoomView {
  v: number;
  roomId: string;
  inviteCode: string;
  phase: Exclude<RoomPhase, 'closed'>;
  members: MemberView[];
  you: { memberId: string; seatId: SeatId | null };
  activeRules: RuleRef[];
  game: GameView | null;
  setResult: SetResultView | null;
  events: RoomGameEvent[];
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
}

export interface RoomReducerOptions {
  gamesPerSet?: number;
  interimAutoAdvanceMs?: number;
  setResultTimeoutMs?: number;
  random?: () => number;
  createAiMemberId?: (index: number) => string;
}

export type RoomEngineResult = GameResult;
