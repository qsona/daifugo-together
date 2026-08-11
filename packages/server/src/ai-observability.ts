import type { AiFallback } from '@daifugo/ai';

import type { RoomAiTurnLog } from './room/socket-gateway.js';

const FALLBACKS: readonly AiFallback[] = [
  'none',
  'partial-search',
  'heuristic',
  'engine-fallback',
];

interface Distribution {
  average: number;
  p95: number;
  maximum: number;
}

export interface AiTurnSummary {
  windowStartedAt: number;
  windowEndedAt: number;
  moves: number;
  fallbacks: Record<AiFallback, number>;
  watchdogs: number;
  modes: Record<RoomAiTurnLog['mode'], number>;
  workerReuses: number;
  wallMs: Distribution;
  queueMs: Distribution;
  setupMs: Distribution;
  searchMs: Distribution;
  worlds: Distribution;
  rootCandidates: Distribution;
  candidateEvaluations: Distribution;
  simulatedSteps: Distribution;
  dangerousPlayFilters: Distribution;
  playouts: Distribution;
}

function emptyFallbacks(): Record<AiFallback, number> {
  return Object.fromEntries(
    FALLBACKS.map((fallback) => [fallback, 0]),
  ) as Record<AiFallback, number>;
}

function percentile95(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

function roundedAverage(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.round(average * 100) / 100;
}

function distribution(values: readonly number[]): Distribution {
  return {
    average: roundedAverage(values),
    p95: percentile95(values),
    maximum: Math.max(...values),
  };
}

export class AiTurnLogAggregator {
  #windowStartedAt: number;
  #fallbacks = emptyFallbacks();
  #watchdogs = 0;
  #modes: Record<RoomAiTurnLog['mode'], number> = {
    basic: 0,
    community: 0,
  };
  #wallMs: number[] = [];
  #queueMs: number[] = [];
  #setupMs: number[] = [];
  #searchMs: number[] = [];
  #worlds: number[] = [];
  #rootCandidates: number[] = [];
  #candidateEvaluations: number[] = [];
  #simulatedSteps: number[] = [];
  #dangerousPlayFilters: number[] = [];
  #playouts: number[] = [];
  #workerReuses = 0;

  constructor(startedAt = Date.now()) {
    this.#windowStartedAt = startedAt;
  }

  record(log: RoomAiTurnLog): void {
    this.#fallbacks[log.fallback] += 1;
    if (log.watchdog) this.#watchdogs += 1;
    this.#modes[log.mode] += 1;
    this.#wallMs.push(log.wallMs);
    this.#queueMs.push(log.queueMs);
    this.#setupMs.push(log.setupMs);
    this.#searchMs.push(log.searchMs);
    this.#worlds.push(log.worlds);
    this.#rootCandidates.push(log.rootCandidates);
    this.#candidateEvaluations.push(log.candidateEvaluations);
    this.#simulatedSteps.push(log.simulatedSteps);
    this.#dangerousPlayFilters.push(log.dangerousPlayFilters);
    this.#playouts.push(log.playouts);
    if (log.workerReused) this.#workerReuses += 1;
  }

  flush(endedAt = Date.now()): AiTurnSummary | undefined {
    const moves = this.#wallMs.length;
    const summary =
      moves === 0
        ? undefined
        : ({
            windowStartedAt: this.#windowStartedAt,
            windowEndedAt: endedAt,
            moves,
            fallbacks: { ...this.#fallbacks },
            watchdogs: this.#watchdogs,
            modes: { ...this.#modes },
            workerReuses: this.#workerReuses,
            wallMs: distribution(this.#wallMs),
            queueMs: distribution(this.#queueMs),
            setupMs: distribution(this.#setupMs),
            searchMs: distribution(this.#searchMs),
            worlds: distribution(this.#worlds),
            rootCandidates: distribution(this.#rootCandidates),
            candidateEvaluations: distribution(this.#candidateEvaluations),
            simulatedSteps: distribution(this.#simulatedSteps),
            dangerousPlayFilters: distribution(this.#dangerousPlayFilters),
            playouts: distribution(this.#playouts),
          } satisfies AiTurnSummary);

    this.#windowStartedAt = endedAt;
    this.#fallbacks = emptyFallbacks();
    this.#watchdogs = 0;
    this.#modes = { basic: 0, community: 0 };
    this.#wallMs = [];
    this.#queueMs = [];
    this.#setupMs = [];
    this.#searchMs = [];
    this.#worlds = [];
    this.#rootCandidates = [];
    this.#candidateEvaluations = [];
    this.#simulatedSteps = [];
    this.#dangerousPlayFilters = [];
    this.#playouts = [];
    this.#workerReuses = 0;
    return summary;
  }
}
