import type { AiPlayer, DecideMoveInput } from '@daifugo/ai';
import type { Play } from '@daifugo/core';
import { describe, expect, it } from 'vitest';

import {
  runAiTurn,
  withResolvedRuleBundles,
  type AiTurnLog,
  type AiTurnMetric,
} from './ai-turn.js';

const plays: Play[] = [
  {
    kind: 'single',
    cards: [{ kind: 'natural', id: 'C03', suit: 'club', rank: '3' }],
    count: 1,
    repRank: '3',
  },
  {
    kind: 'single',
    cards: [{ kind: 'natural', id: 'D04', suit: 'diamond', rank: '4' }],
    count: 1,
    repRank: '4',
  },
];

const input = {
  view: {} as DecideMoveInput['view'],
  legalPlays: plays,
  budget: { softMs: 50, hardMs: 200, maxPlayouts: 2_000, sliceMs: 10 },
  seed: 'server-ai-turn',
  difficulty: {
    name: 'normal',
    budgetScale: 1,
    temperature: 0.3,
    rolloutEpsilon: 0.2,
  },
} satisfies DecideMoveInput;

function player(decideMove: AiPlayer['decideMove']): AiPlayer {
  return {
    decideMove,
    close: async () => {},
  };
}

describe('server AI turn boundary', () => {
  it('合法な探索結果を記録し、較正済み演出遅延を分離して待つ', async () => {
    const metrics: AiTurnMetric[] = [];
    const logs: AiTurnLog[] = [];
    const sleeps: number[] = [];
    let clock = 100;
    const result = await runAiTurn({
      ai: player(async () => {
        clock = 112;
        return {
          play: plays[0]!,
          usedFallback: 'none',
          stats: { playouts: 16, candidates: [], workerThread: true },
        };
      }),
      input,
      fallbackPlay: () => plays[1]!,
      random: () => 0.5,
      now: () => clock,
      sleep: async (delay) => {
        sleeps.push(delay);
      },
      onMetric: (metric) => metrics.push(metric),
      onLog: (log) => logs.push(log),
    });

    expect(result.decision.play).toEqual(plays[0]);
    expect(result.watchdogTriggered).toBe(false);
    expect(result.wallMs).toBe(12);
    expect(result.animationDelayMs).toBe(800);
    expect(sleeps).toEqual([800]);
    expect(metrics.map((metric) => metric.name)).toEqual([
      'ai_playouts_per_move',
      'ai_move_wall_ms',
    ]);
    expect(logs).toContainEqual(
      expect.objectContaining({
        event: 'ai_move',
        fallback: 'none',
        playouts: 16,
      }),
    );
  });

  it('1秒watchdog相当の期限でengine fallbackへ進み、計測する', async () => {
    const metrics: AiTurnMetric[] = [];
    const result = await runAiTurn({
      ai: player(() => new Promise(() => {})),
      input,
      fallbackPlay: () => plays[1]!,
      watchdogMs: 5,
      animationDelay: { minMs: 0, maxMs: 0 },
      sleep: async () => {},
      onMetric: (metric) => metrics.push(metric),
    });

    expect(result.watchdogTriggered).toBe(true);
    expect(result.decision.play).toEqual(plays[1]);
    expect(result.decision.usedFallback).toBe('engine-fallback');
    expect(metrics).toContainEqual(
      expect.objectContaining({
        name: 'ai_fallback_total',
        labels: {
          fallback: 'engine-fallback',
          watchdog: true,
        },
      }),
    );
  });

  it('例外・不正手・壊れたfallbackでも既知の合法手で停止を防ぐ', async () => {
    const invalid = {
      ...plays[0]!,
      cards: [{ kind: 'natural', id: 'S02', suit: 'spade', rank: '2' }],
      repRank: '2',
    } as Play;
    const result = await runAiTurn({
      ai: player(async () => ({
        play: invalid,
        usedFallback: 'none',
      })),
      input,
      fallbackPlay: () => {
        throw new Error('broken authority adapter');
      },
      animationDelay: { minMs: 0, maxMs: 0 },
      sleep: async () => {},
    });

    expect(result.decision.play).toEqual(plays[0]);
    expect(result.decision.usedFallback).toBe('engine-fallback');
  });

  it('AI adapterがPromiseを返す前に同期throwしてもfallbackで継続する', async () => {
    const metrics: AiTurnMetric[] = [];
    const result = await runAiTurn({
      ai: player(() => {
        throw new Error('sync adapter failure');
      }),
      input,
      fallbackPlay: () => plays[1]!,
      animationDelay: { minMs: 0, maxMs: 0 },
      sleep: async () => {},
      onMetric: (metric) => metrics.push(metric),
    });

    expect(result.decision.play).toEqual(plays[1]);
    expect(result.decision.usedFallback).toBe('engine-fallback');
    expect(result.watchdogTriggered).toBe(false);
    expect(metrics).toContainEqual(
      expect.objectContaining({
        name: 'ai_fallback_total',
        labels: {
          fallback: 'engine-fallback',
          watchdog: false,
        },
      }),
    );
  });

  it('rule bundle解決の同期例外もengine fallback境界で継続・計測する', async () => {
    const metrics: AiTurnMetric[] = [];
    const result = await runAiTurn({
      ai: withResolvedRuleBundles(
        player(async () => {
          throw new Error('underlying AI must not run');
        }),
        () => {
          throw new Error('static rule registry unavailable');
        },
      ),
      input: {
        ...input,
        ruleContext: {
          ruleChain: [],
          bundles: [],
          gameSeed: 'authority-seed',
          gameMemory: {},
          hookCalls: {},
          setMemory: {},
        },
      },
      fallbackPlay: () => plays[1]!,
      animationDelay: { minMs: 0, maxMs: 0 },
      sleep: async () => {},
      onMetric: (metric) => metrics.push(metric),
    });

    expect(result.decision.play).toEqual(plays[1]);
    expect(result.decision.usedFallback).toBe('engine-fallback');
    expect(metrics).toContainEqual(
      expect.objectContaining({
        name: 'ai_fallback_total',
        labels: {
          fallback: 'engine-fallback',
          watchdog: false,
        },
      }),
    );
  });

  it('観測・乱数・演出adapterの例外で合法手を失わない', async () => {
    const result = await runAiTurn({
      ai: player(async () => ({
        play: plays[0]!,
        usedFallback: 'none',
      })),
      input,
      fallbackPlay: () => plays[1]!,
      random: () => {
        throw new Error('random unavailable');
      },
      sleep: async () => {
        throw new Error('timer unavailable');
      },
      onMetric: () => {
        throw new Error('metrics unavailable');
      },
      onLog: () => {
        throw new Error('logger unavailable');
      },
    });

    expect(result.decision.play).toEqual(plays[0]);
    expect(result.animationDelayMs).toBe(800);
  });
});
