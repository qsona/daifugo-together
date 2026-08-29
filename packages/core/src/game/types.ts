import type { Card, CardId } from '../cards/card.js';
import type { Play, PlayKind } from '../play/play.js';
import type { StrengthOrder } from '../play/strength.js';
import type { RngState } from '../rng/rng.js';
import type { Effect, RuleChainEntry, Zone } from '../rules/contract.js';
import type { EffectHook } from '../rules/chain.js';
import type {
  BombThrowDirection,
  BombThrowMiniGameState,
} from '../minigame/bomb-throw.js';
import type {
  BinaryQuizOption,
  BinaryQuizQuestion,
  BinaryQuizRaceState,
} from '../minigame/binary-quiz-race.js';

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
  | 'adopted'
  | 'deduped'
  | 'rejected'
  | 'superseded'
  | 'suppressed-announce'
  | 'condition-unmet';

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

export interface PendingChoiceRequest {
  kind?: 'cards' | 'player' | 'miniGame';
  ruleId: RuleId;
  player: PlayerId;
  choiceId: string;
  messageKey: string;
  optionCardIds?: CardId[];
  optionPlayerIds?: PlayerId[];
  count?: number;
  miniGame?: 'bomb_throw_15' | 'binary_quiz_race';
  participants?: PlayerId[];
  durationMs?: number;
  questionSet?: string;
  defaultOption?: BinaryQuizOption;
  roundDurationMs?: number;
  targetScore?: number;
  maxRounds?: number;
  seed?: string;
  miniGameState?: BombThrowMiniGameState | BinaryQuizRaceState;
  simultaneous?: boolean;
}

export type SubmittedRuleChoice =
  | {
      player: PlayerId;
      choiceId: string;
      cardIds: CardId[];
    }
  | {
      player: PlayerId;
      choiceId: string;
      playerId: PlayerId;
    };

export interface PrivateGameState {
  excluded: Card[];
  memory: RuleMemory;
  rng: RngState;
  hookCalls: Record<string, number>;
  /** The public play after which the current field's suit binding was reset. */
  suitBindingResetAfter?: CardId[];
  /** Targeted announce Effects. Kept outside public history. */
  ruleNotices?: {
    id: number;
    ruleId: RuleId;
    messageKey: string;
    params?: Record<string, string>;
    players: PlayerId[];
  }[];
  pendingChoice?: PendingChoiceRequest & {
    hook?: 'afterPlay' | 'onGameStart';
    play?: Play;
    strength?: StrengthOrder;
    playedBy?: PlayerId;
    simultaneousChoices?: PendingChoiceRequest[];
    submittedChoices?: SubmittedRuleChoice[];
    continuation?: {
      remainingRuleIds: RuleId[];
      remainingChoices?: PendingChoiceRequest[];
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
      playerId?: never;
    }
  | {
      type: 'ruleInput';
      player: PlayerId;
      choiceId: string;
      playerId: PlayerId;
      cardIds?: never;
    }
  | {
      type: 'ruleInput';
      player: PlayerId;
      choiceId: string;
      miniGameId: string;
      winnerPlayerId: PlayerId;
      scores: Record<PlayerId, { score: number; hitsTaken: number }>;
      cardIds?: never;
      playerId?: never;
    }
  | {
      type: 'ruleInput';
      player: PlayerId;
      choiceId: string;
      miniGameId: string;
      winnerPlayerIds: PlayerId[];
      scores: Record<PlayerId, { score: number }>;
      cardIds?: never;
      playerId?: never;
      winnerPlayerId?: never;
    }
  | {
      type: 'miniGameCommand';
      player: PlayerId;
      miniGameId: string;
      direction?: BombThrowDirection;
      throwBomb?: boolean;
      round?: number;
      option?: BinaryQuizOption;
    }
  | {
      type: 'miniGameQuestion';
      player: PlayerId;
      miniGameId: string;
      round: number;
      question: BinaryQuizQuestion;
    }
  | {
      type: 'miniGameTick';
      player: PlayerId;
      miniGameId: string;
      deltaMs?: number;
      automatedPlayerIds?: PlayerId[];
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
  privateRuleNotices: {
    id: number;
    ruleId: RuleId;
    messageKey: string;
    params?: Record<string, string>;
  }[];
  pendingChoice?: {
    kind?: 'cards' | 'player' | 'miniGame';
    ruleId: RuleId;
    player: PlayerId;
    choiceId: string;
    messageKey: string;
    count: number;
    cards: Card[];
    players?: PlayerId[];
  } | null;
}
