import type {
  ActionRejection,
  EngineEvent,
  GameAction,
  GameResult,
  GameState,
  PlayerId,
  RuleMemory,
  SetPhase,
  SnapshotMember,
  Standing,
  Title,
} from '../game/types.js';
import type { RuleChainEntry } from '../rules/contract.js';

export interface SetConfig {
  gamesPerSet: number;
  interimAutoAdvanceMs: number;
}

export type SetMember = SnapshotMember;

export interface SetState {
  setId: string;
  config: SetConfig;
  phase: SetPhase;
  members: SetMember[];
  ruleChain: RuleChainEntry[];
  setSeed: string;
  results: GameResult[];
  setMemory: RuleMemory;
  currentGame: GameState | null;
  outcome: SetOutcome | null;
  draining: boolean;
}

export type SetAction =
  GameAction | { type: 'advance' } | { type: 'requestDrain' };

export interface SetOutcome {
  setId: string;
  standings: {
    player: PlayerId;
    totalStanding: Standing;
    title: Title;
    points: number;
  }[];
  members: SetMember[];
  wasActiveRuleIds: string[];
  firedRuleIds: string[];
  results: GameResult[];
  completion: 'completed' | 'drained';
  gamesPlayed: number;
}

export interface SetEndedEvent {
  type: 'setEnded';
  totals: SetOutcome['standings'];
  completion: SetOutcome['completion'];
  gamesPlayed: number;
}

export type SetRejection =
  | ActionRejection
  | {
      code: 'INVALID_SET_PHASE';
      detail: string;
    };

export interface SetTransition {
  state: SetState;
  events: (EngineEvent | SetEndedEvent)[];
  rejections: SetRejection[];
  acceptedAction?: SetAction;
}

export interface ReplayInit {
  formatVersion: 1;
  engineVersion: string;
  contractVersion: number;
  setId: string;
  setSeed: string;
  config: SetConfig;
  members: SetMember[];
  ruleChain: RuleChainEntry[];
}

export interface ReplayAction {
  seq: number;
  action: SetAction;
}

export type ReplayRecord = ReplayInit | ReplayAction;

export interface ReplayLogBoundary {
  append(record: ReplayRecord): void | Promise<void>;
}
