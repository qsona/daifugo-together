import type {
  CardId,
  Play,
  PlayerSnapshot,
  RuleChainEntry,
  RuleMeta,
  RuleMemory,
} from '@daifugo/core';

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
  /** Maximum simulated actions per playout, including the root play. */
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
  worlds?: number;
  rootCandidates?: number;
  candidateEvaluations?: number;
  simulatedSteps?: number;
  dangerousPlayFilters?: number;
  queueMs?: number;
  setupMs?: number;
  searchMs?: number;
  workerReused?: boolean;
  ruleIds?: string[];
  effectiveStrengthInverted?: boolean;
}

export type AiFallback =
  'none' | 'partial-search' | 'heuristic' | 'engine-fallback';

export interface AiRuleBundleRef {
  ruleId: string;
  moduleUrl: string;
  bundleHash: string;
  contractVersion: number;
  meta: RuleMeta;
}

export interface AiRuleContext {
  ruleChain: RuleChainEntry[];
  bundles: AiRuleBundleRef[];
  gameSeed: string;
  gameMemory: RuleMemory;
  hookCalls: Record<string, number>;
  /** clearSuitBindingが記録した、現在のスート縛りの解除境界。 */
  suitBindingResetAfter: CardId[] | null;
  setMemory: RuleMemory;
}

export interface DecideMoveInput {
  view: PlayerSnapshot;
  legalPlays: Play[];
  budget: ThinkBudget;
  seed: string;
  difficulty: DifficultyProfile;
  ruleContext?: AiRuleContext;
}

export interface AiDecision {
  play: Play;
  usedFallback: AiFallback;
  fallbackReason?: string;
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
  maxPlayouts: 64,
  sliceMs: 10,
};

export const DEFAULT_MCTS_CONFIG: MctsConfig = {
  ucbC: 0.7,
  maxTreeDepth: 1,
  cutoffSteps: 65,
  rootCandidateCap: 8,
  playoutBatchSize: 4,
};
