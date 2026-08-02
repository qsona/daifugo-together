import type { Card, CardId } from '../cards/card.js';
import type { Play, PlayKind } from '../play/play.js';
import type { StrengthOrder } from '../play/strength.js';
import type { RngState } from '../rng/rng.js';
import type { Effect, RuleChainEntry, Zone } from '../rules/contract.js';
import type { EffectHook } from '../rules/chain.js';

export type PlayerId = string;
export type RuleId = string;
export type Seed = string;
export type Standing = 1 | 2 | 3 | 4;
export type Title = '大富豪' | '富豪' | '貧民' | '大貧民';

export const TITLE_BY_STANDING: Record<Standing, Title> = {
  1: '大富豪',
  2: '富豪',
  3: '貧民',
  4: '大貧民',
};

export interface GameConfig {
  gameIndex: number;
  seats: PlayerId[];
  gameSeed: Seed;
  ruleChain: RuleChainEntry[];
}

export type PlayerStatus = 'active' | 'finished' | 'retired';

export interface PlayerState {
  id: PlayerId;
  hand: Card[];
  status: PlayerStatus;
  standing?: Standing;
  skipCount: number;
}

export interface FieldState {
  current?: { play: Play; by: PlayerId };
  passedSinceLastPlay: PlayerId[];
}

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type RuleMemory = Record<RuleId, Record<string, JsonValue>>;

export type GamePhase = 'awaitingPlay' | 'awaitingChoice' | 'finished';

export type PublicGameEvent =
  | {
      type: 'gameStarted';
      firstPlayer: PlayerId;
      handCounts: Record<PlayerId, number>;
    }
  | { type: 'played'; player: PlayerId; play: Play }
  | { type: 'passed'; player: PlayerId }
  | {
      type: 'fieldCleared';
      reason: 'allPassed' | 'rule';
      nextLeader: PlayerId;
    }
  | { type: 'turnChanged'; player: PlayerId }
  | {
      type: 'playerFinished';
      player: PlayerId;
      standing: Standing;
      title: Title;
    }
  | {
      type: 'gameEnded';
      standings: {
        player: PlayerId;
        standing: Standing;
        title: Title;
      }[];
    }
  | {
      type: 'ruleFired';
      ruleId: RuleId;
      messageKey: string | null;
      params?: Record<string, string>;
    }
  | {
      type: 'failsafe';
      reason: 'leadNoLegalMove' | 'turnLimit';
      relatedRuleIds: RuleId[];
    }
  | {
      type: 'playerRetired';
      player: PlayerId;
      cardCount: number;
      standing: Standing;
    }
  | {
      type: 'cardsMoved';
      by: RuleId;
      from: Zone;
      to: Zone;
      count: number;
      cardIds?: CardId[];
    };

export type EffectResolutionStatus =
  'adopted' | 'deduped' | 'rejected' | 'superseded' | 'suppressed-announce';

export type EngineEvent =
  | PublicGameEvent
  | {
      type: 'effectApplied' | 'effectRejected';
      hook: EffectHook;
      ruleId: RuleId;
      effect: Effect;
      resolution: EffectResolutionStatus;
      conflictKey: string | null;
      winnerRuleId?: RuleId;
      detail?: JsonValue;
    };

export interface PublicGameState {
  phase: GamePhase;
  direction: 1 | -1;
  turn: PlayerId | null;
  field: FieldState;
  discard: Card[];
  standingsTaken: Standing[];
  history: PublicGameEvent[];
  firedRules: RuleId[];
  turnCount: number;
}

export interface PrivateGameState {
  excluded: Card[];
  memory: RuleMemory;
  rng: RngState;
  hookCalls: Record<string, number>;
  pendingChoice?: {
    ruleId: RuleId;
    player: PlayerId;
    choiceId: string;
    messageKey: string;
    optionCardIds: CardId[];
    count: number;
    play: Play;
    strength: StrengthOrder;
    continuation?: {
      remainingRuleIds: RuleId[];
      clearRequested: boolean;
    };
  };
}

export interface GameState {
  public: PublicGameState;
  private: PrivateGameState;
  players: Record<PlayerId, PlayerState>;
}

export type GameAction =
  | {
      type: 'play';
      player: PlayerId;
      cards: CardId[];
      kind?: PlayKind;
    }
  | { type: 'pass'; player: PlayerId }
  | {
      type: 'ruleInput';
      player: PlayerId;
      choiceId: string;
      cardIds: CardId[];
    };

export type ActionRejectionCode =
  | 'NOT_YOUR_TURN'
  | 'CARD_NOT_IN_HAND'
  | 'INVALID_PLAY_SHAPE'
  | 'TOO_WEAK'
  | 'FORBIDDEN_BY_RULE'
  | 'PASS_ON_LEAD'
  | 'NO_PENDING_CHOICE'
  | 'INVALID_RULE_CHOICE';

export interface ActionRejection {
  player: PlayerId;
  code: ActionRejectionCode;
  reasonKey?: string;
}

export interface GameTransition {
  state: GameState;
  events: EngineEvent[];
  rejections: ActionRejection[];
  setMemory?: RuleMemory;
}

export interface GameResult {
  gameIndex: number;
  standings: {
    player: PlayerId;
    standing: Standing;
    title: Title;
  }[];
  firedRuleIds: RuleId[];
}

export type SetPhase =
  | { name: 'gameInProgress'; gameIndex: number }
  | { name: 'interimResult'; gameIndex: number }
  | { name: 'setResult' };

export interface SnapshotMember {
  id: PlayerId;
  displayName: string;
  isAI: boolean;
}

export interface SnapshotContext {
  setId: string;
  setPhase: SetPhase;
  members: SnapshotMember[];
  setResults: GameResult[];
}

export interface PlayerSnapshot {
  forPlayer: PlayerId;
  setId: string;
  setPhase: SetPhase;
  gameIndex: number;
  gamePhase: GamePhase;
  turn: PlayerId | null;
  direction: 1 | -1;
  trickNumber: number;
  seats: PlayerId[];
  players: {
    id: PlayerId;
    displayName: string;
    isAI: boolean;
    handCount: number;
    status: PlayerStatus;
    standing: Standing | null;
    title: Title | null;
  }[];
  hand: Card[];
  field: { play: Play; by: PlayerId } | null;
  passedSinceLastPlay: PlayerId[];
  discardCount: number;
  excludedCount: number;
  legalMoves: Play[] | null;
  canPass: boolean;
  strengthNote: { inverted: boolean };
  setResults: GameResult[];
  effectiveRules: { ruleId: RuleId; name: string }[];
  history: PublicGameEvent[];
  pendingChoice?: {
    ruleId: RuleId;
    player: PlayerId;
    choiceId: string;
    messageKey: string;
    count: number;
    cards: Card[];
  } | null;
}
