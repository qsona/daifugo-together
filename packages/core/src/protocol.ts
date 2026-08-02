import { z } from 'zod';

import type { Card, Suit } from './cards/card.js';
import type { NotificationView } from './notification.js';
import type { Play } from './play/play.js';
import type { Standing, Title } from './game/types.js';

export type SeatId = 0 | 1 | 2 | 3;

export type RoomErrorCode =
  | 'ALREADY_IN_ROOM'
  | 'ROOM_FULL'
  | 'ROOM_CLOSED'
  | 'NOT_IN_ROOM'
  | 'NOT_HOST'
  | 'NOT_WAITING'
  | 'NOT_PLAYING'
  | 'NOT_SET_RESULT'
  | 'NOT_YOUR_TURN'
  | 'STALE_TURN'
  | 'ILLEGAL_PLAY'
  | 'INVALID_SET_PHASE'
  | 'INVALID_NAME';

export type ErrorCode =
  | RoomErrorCode
  | 'ROOM_NOT_FOUND'
  | 'ROOM_IN_GAME'
  | 'ROOM_SOLO_ONLY'
  | 'INVITE_SPACE_EXHAUSTED'
  | 'BAD_PAYLOAD'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export type Ack<T> =
  { ok: true; value: T } | { ok: false; code: ErrorCode; message?: string };

export type RoomCloseReason =
  'noHumans' | 'lobbyExpired' | 'abandoned' | 'setEndedNoContinue';

export type RoomPhase = 'waiting' | 'playing' | 'setResult' | 'closed';
export type RoomMode = 'basic' | 'community';

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
      /** Trusted rule metadata から server が解決した表示文言。 */
      message: string | null;
      /** 旧クライアントの診断用。名前だけの発火では省略する。 */
      messageKey?: string;
    }
);

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
  | { t: 'ruleFired'; ruleId: string; messageKey: string | null }
  | { t: 'failsafe'; reason: 'leadNoLegalMove' | 'turnLimit' }
  | { t: 'playerRetired'; seat: SeatId; cardCount: number; rank: Standing }
  | {
      t: 'cardsMoved';
      ruleId: string;
      fromSeat: SeatId | null;
      to: 'hand' | 'field' | 'discard';
      count: number;
      /** 公開ゾーンが絡む移動だけ札面を含む。hand→hand は null。 */
      cards: Card[] | null;
    };

/**
 * 継続中のルール状態(革命・イレブンバック・縛りなど)を 1 件表す。
 * scope はその状態が死ぬ場所: 'game' は局が終わるまで、'field' は場が流れるまで。
 */
export interface GameStatusView {
  ruleId: string;
  name: string;
  scope: 'game' | 'field';
  /**
   * 縛りが要求するスート構成。構成をそのまま並べるので同じスートが複数入りうる
   * (♥2枚の組で縛られたら ['heart', 'heart'])。縛り以外の状態では省略する。
   */
  suits?: readonly Suit[];
}

export interface GameResultView {
  gameNo: number;
  /** points はこの戦で得た順位点(POINTS_BY_STANDING、5-3-2-1)。 */
  standings: { seat: SeatId; rank: Standing; title: Title; points: number }[];
  firedRuleIds: string[];
}

export interface MultiplayerGameView {
  gameNo: number;
  status: 'playing' | 'intermission';
  /**
   * ゲーム間リザルトの全員共通タイマー。
   * サーバーが確定した終了時刻を配ることで、途中参加・再接続でも表示と遷移を揃える。
   */
  intermission: {
    durationMs: number;
    endsAt: number;
    /** このプレイヤーが次戦へ進む準備を済ませているか。 */
    ready: boolean;
  } | null;
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
  /**
   * 正味の強さが反転しているか。反転するルールが 2 つ重なれば元の向きへ戻るので false。
   * 「どのルールが生きているか」は statuses、「いまどちら向きか」はこちらが引き受ける。
   */
  strengthInverted: boolean;
  /** 継続中の状態。局スコープを先に、同スコープ内はルールチェーン順で並ぶ。 */
  statuses: readonly GameStatusView[];
  previousResults: GameResultView[];
  yourHand: Card[];
  legalMoves: Play[] | null;
  pendingChoice?: {
    kind?: 'cards' | 'player';
    ruleId: string;
    choiceId: string;
    message: string | null;
    seat: SeatId;
    count: number;
    cards: Card[] | null;
    players?: { seat: SeatId; displayName: string }[] | null;
  } | null;
}

export interface SetResultView {
  setId: string;
  standings: {
    memberId: string;
    totalRank: number;
    title: string;
    ranks: number[];
    /** points はセット(3 戦)の合計順位点。 */
    points: number;
  }[];
  /**
   * 最終戦の結果。セットを完走したときだけ入る。
   * 中断で終わったセット(drained)では、最後に完走した戦が最終戦とは限らないので null。
   */
  finalGame: GameResultView | null;
  firedRules: {
    ruleId: string;
    ruleName: string;
    count: number;
  }[];
  respondBy: number;
}

export interface PlayerRoomView {
  v: number;
  roomId: string;
  inviteCode: string;
  mode: RoomMode;
  phase: Exclude<RoomPhase, 'closed'>;
  members: MemberView[];
  you: { memberId: string; seatId: SeatId | null };
  activeRules: RuleRef[];
  game: MultiplayerGameView | null;
  setResult: SetResultView | null;
  events: RoomGameEvent[];
}

const emptyPayloadSchema = z.object({}).strict();
const turnSeqSchema = z.number().int().nonnegative();

export const clientPayloadSchemas = {
  'room:create': z
    .object({ mode: z.enum(['basic', 'community']).optional() })
    .strict(),
  'room:join': z
    .object({ inviteCode: z.string().regex(/^[0-9]{5}$/) })
    .strict(),
  'room:leave': emptyPayloadSchema,
  'room:start': emptyPayloadSchema,
  'room:continue': emptyPayloadSchema,
  'game:play': z
    .object({
      turnSeq: turnSeqSchema,
      cards: z.array(z.string().min(1)).min(1).max(14),
      kind: z.enum(['single', 'set', 'sequence']).optional(),
    })
    .strict(),
  'game:ruleInput': z.union([
    z
      .object({
        turnSeq: turnSeqSchema,
        choiceId: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
        cardIds: z.array(z.string().min(1)).min(1).max(14),
      })
      .strict(),
    z
      .object({
        turnSeq: turnSeqSchema,
        choiceId: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
        playerId: z.string().min(1),
      })
      .strict(),
  ]),
  'game:pass': z.object({ turnSeq: turnSeqSchema }).strict(),
  'game:readyNext': emptyPayloadSchema,
  'sync:request': emptyPayloadSchema,
  'user:rename': z
    .object({
      displayName: z
        .string()
        .trim()
        .min(1)
        .refine((value) => [...value].length <= 10)
        .refine(
          (value) =>
            ![...value].some((character) => {
              const code = character.codePointAt(0) ?? 0;
              return code <= 31 || code === 127;
            }),
        ),
    })
    .strict(),
} as const;

export type ClientEvent = keyof typeof clientPayloadSchemas;
export type ClientPayload<Event extends ClientEvent> = z.infer<
  (typeof clientPayloadSchemas)[Event]
>;

export interface ClientToServerEvents {
  'room:create': (
    payload: ClientPayload<'room:create'>,
    ack: (result: Ack<{ roomId: string; inviteCode: string }>) => void,
  ) => void;
  'room:join': (
    payload: ClientPayload<'room:join'>,
    ack: (result: Ack<{ roomId: string }>) => void,
  ) => void;
  'room:leave': (
    payload: ClientPayload<'room:leave'>,
    ack: (result: Ack<Record<string, never>>) => void,
  ) => void;
  'room:start': (
    payload: ClientPayload<'room:start'>,
    ack: (result: Ack<Record<string, never>>) => void,
  ) => void;
  'room:continue': (
    payload: ClientPayload<'room:continue'>,
    ack: (result: Ack<Record<string, never>>) => void,
  ) => void;
  'game:play': (
    payload: ClientPayload<'game:play'>,
    ack: (result: Ack<Record<string, never>>) => void,
  ) => void;
  'game:ruleInput': (
    payload: ClientPayload<'game:ruleInput'>,
    ack: (result: Ack<Record<string, never>>) => void,
  ) => void;
  'game:pass': (
    payload: ClientPayload<'game:pass'>,
    ack: (result: Ack<Record<string, never>>) => void,
  ) => void;
  'game:readyNext': (
    payload: ClientPayload<'game:readyNext'>,
    ack: (result: Ack<Record<string, never>>) => void,
  ) => void;
  'sync:request': (
    payload: ClientPayload<'sync:request'>,
    ack: (result: Ack<Record<string, never>>) => void,
  ) => void;
  'user:rename': (
    payload: ClientPayload<'user:rename'>,
    ack: (result: Ack<Record<string, never>>) => void,
  ) => void;
}

export interface ServerToClientEvents {
  'session:ready': (payload: {
    userId: string;
    userToken: string;
    displayName: string;
    registered: boolean;
    room: PlayerRoomView | null;
  }) => void;
  'room:state': (payload: PlayerRoomView) => void;
  'room:closed': (payload: { reason: RoomCloseReason }) => void;
  'session:superseded': (payload: Record<string, never>) => void;
  'notification:sync': (payload: { unreadCount: number }) => void;
  'notification:new': (payload: { item: NotificationView }) => void;
}

export type InterServerEvents = Record<never, never>;

export interface SocketData {
  session: {
    userId: string;
    userToken: string;
    displayName: string;
    registered: boolean;
  };
}
