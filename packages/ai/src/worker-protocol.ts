import type { Play } from '@daifugo/core';

import type {
  AiRuleContext,
  DifficultyProfile,
  MctsConfig,
  SearchStats,
  ThinkBudget,
} from './types.js';

export interface SearchRequest {
  view: import('@daifugo/core').PlayerSnapshot;
  legalPlays: Play[];
  budget: ThinkBudget;
  difficulty: DifficultyProfile;
  config: MctsConfig;
  seed: string;
  ruleContext?: AiRuleContext;
}

export interface SearchResponse {
  play: Play;
  stats: SearchStats;
  completed: boolean;
}

export interface WorkerRequest {
  id: number;
  payload: SearchRequest;
}

export interface WorkerReady {
  kind: 'ready';
}

export interface WorkerProgress {
  kind: 'progress';
  id: number;
  value: SearchResponse;
}

export interface WorkerSuccess {
  kind: 'result';
  id: number;
  value: SearchResponse;
}

export interface WorkerFailure {
  kind: 'error';
  id: number;
  error: string;
}

export type WorkerResponse =
  WorkerReady | WorkerProgress | WorkerSuccess | WorkerFailure;
