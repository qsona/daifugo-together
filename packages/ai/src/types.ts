import type { Play, PlayerSnapshot } from '@daifugo/core';

export interface ThinkBudget {
  softMs: number;
  hardMs: number;
  maxPlayouts: number;
  sliceMs: number;
}

export interface DifficultyProfile {
  name: 'easy' | 'normal' | 'hard';
  budgetScale: number;
  temperature: number;
  rolloutEpsilon: number;
}

export interface MctsConfig {
  ucbC: number;
  maxTreeDepth: number;
  cutoffSteps: number;
  rootCandidateCap: number;
  playoutBatchSize: number;
}

export interface CandidateStats {
  cardIds: string[];
  visits: number;
  meanReward: number;
}

export interface SearchStats {
  playouts: number;
  candidates: CandidateStats[];
  workerThread: boolean;
}

export type AiFallback =
  'none' | 'partial-search' | 'heuristic' | 'engine-fallback';

export interface DecideMoveInput {
  view: PlayerSnapshot;
  legalPlays: Play[];
  budget: ThinkBudget;
  seed: string;
  difficulty: DifficultyProfile;
}

export interface AiDecision {
  play: Play;
  usedFallback: AiFallback;
  stats?: SearchStats;
}

export interface AiPlayer {
  decideMove(input: DecideMoveInput): Promise<AiDecision>;
  close(): Promise<void>;
}

export const NORMAL_DIFFICULTY: DifficultyProfile = {
  name: 'normal',
  budgetScale: 1,
  temperature: 0.3,
  rolloutEpsilon: 0.2,
};

export const DEFAULT_THINK_BUDGET: ThinkBudget = {
  softMs: 50,
  hardMs: 200,
  maxPlayouts: 2_000,
  sliceMs: 10,
};

export const DEFAULT_MCTS_CONFIG: MctsConfig = {
  ucbC: 0.7,
  maxTreeDepth: 1,
  cutoffSteps: 24,
  rootCandidateCap: 12,
  playoutBatchSize: 16,
};
