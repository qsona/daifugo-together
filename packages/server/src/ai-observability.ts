import type { AiFallback } from '@daifugo/ai';

import type { RoomAiTurnLog } from './room/socket-gateway.js';

const FALLBACKS: readonly AiFallback[] = [
  'none',
  'partial-search',
  'heuristic',
  'engine-fallback',
];

export interface AiTurnSummary {
  windowStartedAt: number;
  windowEndedAt: number;
  moves: number;
  fallbacks: Record<AiFallback, number>;
  watchdogs: number;
  modes: Record<RoomAiTurnLog['mode'], number>;
  wallMs: {
    average: number;
    p95: number;
    maximum: number;
  };
  playouts: {
    average: number;
    p95: number;
    maximum: number;
  };
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

export class AiTurnLogAggregator {
  #windowStartedAt: number;
  #fallbacks = emptyFallbacks();
  #watchdogs = 0;
  #modes: Record<RoomAiTurnLog['mode'], number> = {
    basic: 0,
    community: 0,
  };
  #wallMs: number[] = [];
  #playouts: number[] = [];

  constructor(startedAt = Date.now()) {
    this.#windowStartedAt = startedAt;
  }

  record(log: RoomAiTurnLog): void {
    this.#fallbacks[log.fallback] += 1;
    if (log.watchdog) this.#watchdogs += 1;
    this.#modes[log.mode] += 1;
    this.#wallMs.push(log.wallMs);
    this.#playouts.push(log.playouts);
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
            wallMs: {
              average: roundedAverage(this.#wallMs),
              p95: percentile95(this.#wallMs),
              maximum: Math.max(...this.#wallMs),
            },
            playouts: {
              average: roundedAverage(this.#playouts),
              p95: percentile95(this.#playouts),
              maximum: Math.max(...this.#playouts),
            },
          } satisfies AiTurnSummary);

    this.#windowStartedAt = endedAt;
    this.#fallbacks = emptyFallbacks();
    this.#watchdogs = 0;
    this.#modes = { basic: 0, community: 0 };
    this.#wallMs = [];
    this.#playouts = [];
    return summary;
  }
}
