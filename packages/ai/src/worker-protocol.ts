import type { Play } from '@daifugo/core';

import type {
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

export interface WorkerSuccess {
  id: number;
  ok: true;
  value: SearchResponse;
}

export interface WorkerFailure {
  id: number;
  ok: false;
  error: string;
}

export type WorkerResponse = WorkerSuccess | WorkerFailure;
