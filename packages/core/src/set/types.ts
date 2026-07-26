import type {
  ActionRejection,
  GameAction,
  GameResult,
  GameState,
  PlayerId,
  PublicGameEvent,
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
}

export type SetAction = GameAction | { type: 'advance' };

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
}

export type SetRejection =
  | ActionRejection
  | {
      code: 'INVALID_SET_PHASE';
      detail: string;
    };

export interface SetTransition {
  state: SetState;
  events: PublicGameEvent[];
  rejections: SetRejection[];
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
