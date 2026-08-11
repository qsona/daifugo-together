import { describe, expect, it } from 'vitest';

import { AiTurnLogAggregator } from './ai-observability.js';
import {
  ROOM_AI_THINK_BUDGET,
  type RoomAiTurnLog,
} from './room/socket-gateway.js';

function log(
  fallback: RoomAiTurnLog['fallback'],
  wallMs: number,
  playouts: number,
  overrides: Partial<RoomAiTurnLog> = {},
): RoomAiTurnLog {
  return {
    event: 'ai_move',
    fallback,
    watchdog: false,
    wallMs,
    playouts,
    worlds: 0,
    rootCandidates: 0,
    candidateEvaluations: 0,
    simulatedSteps: 0,
    dangerousPlayFilters: 0,
    queueMs: 0,
    setupMs: 0,
    searchMs: 0,
    workerReused: false,
    ruleIds: [],
    animationDelayMs: 0,
    roomId: 'room-1',
    setId: 'set-1',
    gameIndex: 0,
    turnSeq: 1,
    memberId: 'member-1',
    mode: 'basic',
    ...overrides,
  };
}

describe('AI turn log aggregation', () => {
  it('ルームAIを全候補の公平な比較が可能な既定予算に固定する', () => {
    expect(ROOM_AI_THINK_BUDGET).toEqual({
      softMs: 50,
      hardMs: 400,
      maxPlayouts: 64,
      sliceMs: 10,
    });
  });

  it('AI手番をfallback・mode・watchdogと分布へ集約する', () => {
    const aggregator = new AiTurnLogAggregator(1_000);
    aggregator.record(log('none', 60, 3));
    aggregator.record(
      log('partial-search', 150, 2, {
        mode: 'community',
        watchdog: true,
      }),
    );
    aggregator.record(log('heuristic', 90, 0));

    expect(aggregator.flush(61_000)).toEqual({
      windowStartedAt: 1_000,
      windowEndedAt: 61_000,
      moves: 3,
      fallbacks: {
        none: 1,
        'partial-search': 1,
        heuristic: 1,
        'engine-fallback': 0,
      },
      watchdogs: 1,
      modes: { basic: 2, community: 1 },
      workerReuses: 0,
      wallMs: { average: 100, p95: 150, maximum: 150 },
      queueMs: { average: 0, p95: 0, maximum: 0 },
      setupMs: { average: 0, p95: 0, maximum: 0 },
      searchMs: { average: 0, p95: 0, maximum: 0 },
      worlds: { average: 0, p95: 0, maximum: 0 },
      rootCandidates: { average: 0, p95: 0, maximum: 0 },
      candidateEvaluations: { average: 0, p95: 0, maximum: 0 },
      simulatedSteps: { average: 0, p95: 0, maximum: 0 },
      dangerousPlayFilters: { average: 0, p95: 0, maximum: 0 },
      playouts: { average: 1.67, p95: 3, maximum: 3 },
    });
  });

  it('flush後は次の観測窓へ切り替え、空窓を出力しない', () => {
    const aggregator = new AiTurnLogAggregator(1_000);
    aggregator.record(log('none', 70, 3));
    expect(aggregator.flush(2_000)?.moves).toBe(1);
    expect(aggregator.flush(3_000)).toBeUndefined();

    aggregator.record(log('engine-fallback', 1_000, 0));
    expect(aggregator.flush(4_000)).toMatchObject({
      windowStartedAt: 3_000,
      windowEndedAt: 4_000,
      moves: 1,
      fallbacks: { 'engine-fallback': 1 },
    });
  });
});
