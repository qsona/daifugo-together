import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  buildPlayerSnapshot,
  createInProcessRuleChainPort,
  enumerateLegalPlays,
  reduceSet,
  startGame,
  startSet,
  type GameConfig,
  type RuleChainEntry,
  type RuleModule,
  type RuleRuntime,
  type SetAction,
  type SetState,
  type SnapshotContext,
} from '@daifugo/core';
import { describe, expect, it } from 'vitest';

import { createAiPlayer } from './ai-player.js';
import { sameCandidate } from './heuristic.js';
import { rule as ai02RuleFixture } from './test-fixtures/ai02-rule.js';
import {
  DEFAULT_MCTS_CONFIG,
  DEFAULT_THINK_BUDGET,
  NORMAL_DIFFICULTY,
} from './types.js';
import { AiWorkerPool } from './worker-pool.js';

const seats = ['human', 'bot-1', 'bot-2', 'bot-3'];

function gameConfig(state: SetState): GameConfig {
  if (state.phase.name === 'setResult') {
    throw new Error('Set has no active game');
  }
  return {
    gameIndex: state.phase.gameIndex,
    seats,
    gameSeed: `${state.setSeed}:${state.phase.gameIndex}`,
    ruleChain: [],
  };
}

function snapshotContext(state: SetState): SnapshotContext {
  return {
    setId: state.setId,
    setPhase: state.phase,
    members: state.members,
    setResults: state.results,
  };
}

describe('AI-01', () => {
  it('ルート候補手を含めて最大65手までプレイアウトする', () => {
    expect(DEFAULT_MCTS_CONFIG.cutoffSteps).toBe(65);
  });

  it('同じ観測・seedからworker threadで同じ合法手を選ぶ', async () => {
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'ai-unit-game',
      ruleChain: [],
    };
    const state = startGame(config).state;
    const player = state.public.turn;
    if (!player) {
      throw new Error('Expected opening turn');
    }
    const context: SnapshotContext = {
      setId: 'ai-unit-set',
      setPhase: { name: 'gameInProgress', gameIndex: 0 },
      members: seats.map((id) => ({
        id,
        displayName: id,
        isAI: id !== 'human',
      })),
      setResults: [],
    };
    const input = {
      view: buildPlayerSnapshot(config, state, context, player),
      legalPlays: enumerateLegalPlays(config, state, player),
      budget: {
        softMs: 5,
        hardMs: 1_000,
        maxPlayouts: 12,
        sliceMs: 10,
      },
      seed: 'same-ai-seed',
      difficulty: NORMAL_DIFFICULTY,
    };
    const ai = createAiPlayer();
    try {
      const first = await ai.decideMove(input);
      const second = await ai.decideMove(input);

      expect(first.usedFallback).toBe('none');
      expect(first.stats?.workerThread).toBe(true);
      expect(
        input.legalPlays.some((play) => sameCandidate(play, first.play)),
      ).toBe(true);
      expect(second.play).toEqual(first.play);
      expect(second.stats?.candidates).toEqual(first.stats?.candidates);
      expect(first.stats?.rootCandidates).toBe(input.legalPlays.length);
      expect(
        first.stats?.candidates.every(
          (candidate) => candidate.visits === first.stats?.worlds,
        ),
      ).toBe(true);
      expect(first.stats?.candidateEvaluations).toBe(
        (first.stats?.rootCandidates ?? 0) * (first.stats?.worlds ?? 0),
      );
      expect(first.stats?.workerReused).toBe(false);
      expect(second.stats?.workerReused).toBe(true);
    } finally {
      await ai.close();
    }
  });

  it('1人+AI 3人で3ゲームのセットを拒否なく完走する', async () => {
    let state = startSet({
      setId: 'ai-integration-set',
      config: { gamesPerSet: 3, interimAutoAdvanceMs: 0 },
      members: seats.map((id) => ({
        id,
        displayName: id,
        isAI: id !== 'human',
      })),
      ruleChain: [],
      setSeed: 'ai-integration',
    });
    const ai = createAiPlayer({
      search: { cutoffSteps: 8, rootCandidateCap: 6 },
    });
    let actions = 0;
    try {
      while (state.phase.name !== 'setResult' && actions < 2_000) {
        if (state.phase.name === 'interimResult') {
          const advanced = reduceSet(state, { type: 'advance' });
          expect(advanced.rejections).toEqual([]);
          state = advanced.state;
          actions += 1;
          continue;
        }
        const game = state.currentGame;
        const player = game?.public.turn;
        if (!game || !player) {
          throw new Error('Expected an active AI test turn');
        }
        const config = gameConfig(state);
        const legal = enumerateLegalPlays(config, game, player);
        let action: SetAction;
        if (legal.length === 0) {
          action = { type: 'pass', player };
        } else if (player === 'human') {
          action = {
            type: 'play',
            player,
            cards: legal[0]!.cards.map((card) => card.id),
          };
        } else {
          const decision = await ai.decideMove({
            view: buildPlayerSnapshot(
              config,
              game,
              snapshotContext(state),
              player,
            ),
            legalPlays: legal,
            budget: {
              softMs: 1,
              hardMs: 1_000,
              maxPlayouts: 2,
              sliceMs: 1,
            },
            seed: `${state.setSeed}:${state.phase.gameIndex}:${game.public.turnCount}:${player}`,
            difficulty: NORMAL_DIFFICULTY,
          });
          expect(legal.some((play) => sameCandidate(play, decision.play))).toBe(
            true,
          );
          action = {
            type: 'play',
            player,
            cards: decision.play.cards.map((card) => card.id),
          };
        }
        const transition = reduceSet(state, action);
        expect(transition.rejections).toEqual([]);
        state = transition.state;
        actions += 1;
      }
    } finally {
      await ai.close();
    }

    expect(state.phase.name).toBe('setResult');
    expect(state.results).toHaveLength(3);
    expect(state.outcome?.completion).toBe('completed');
    expect(actions).toBeLessThan(2_000);
  }, 20_000);

  it('B-7の仮値としてworker poolを1本に固定する', async () => {
    const pool = new AiWorkerPool();
    expect(pool.size).toBe(1);
    await pool.close();
  });

  it('既定soft予算の探索を完了し、同じseedから同じ手を返す', async () => {
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'ai-default-budget',
      ruleChain: [],
    };
    const state = startGame(config).state;
    const player = state.public.turn!;
    const context: SnapshotContext = {
      setId: 'ai-default-budget',
      setPhase: { name: 'gameInProgress', gameIndex: 0 },
      members: seats.map((id) => ({
        id,
        displayName: id,
        isAI: id !== 'human',
      })),
      setResults: [],
    };
    const input = {
      view: buildPlayerSnapshot(config, state, context, player),
      legalPlays: enumerateLegalPlays(config, state, player),
      // hardMs は worker 起動時間も含むため、共有CIのCPU速度に依存させない。
      // softMs/maxPlayouts/sliceMs は本番既定値のまま探索結果を検証する。
      budget: { ...DEFAULT_THINK_BUDGET, hardMs: 2_000 },
      seed: 'default-budget-seed',
      difficulty: NORMAL_DIFFICULTY,
    };
    const ai = createAiPlayer();
    try {
      const first = await ai.decideMove(input);
      const second = await ai.decideMove(input);

      expect(first.usedFallback).toBe('none');
      expect(first.stats?.playouts).toBeGreaterThanOrEqual(
        input.legalPlays.length,
      );
      expect(first.stats?.workerThread).toBe(true);
      expect(first.stats?.candidates).toHaveLength(input.legalPlays.length);
      expect(
        Math.max(
          ...(first.stats?.candidates.map((candidate) => candidate.visits) ?? [
            0,
          ]),
        ),
      ).toBeGreaterThan(1);
      expect(second.play).toEqual(first.play);
      expect(second.stats?.candidates).toEqual(first.stats?.candidates);
    } finally {
      await ai.close();
    }
  });

  it('協調的なhard期限で公平な途中結果を返し、workerを再利用する', async () => {
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'ai-cooperative-deadline',
      ruleChain: [],
    };
    const state = startGame(config).state;
    const player = state.public.turn!;
    const view = buildPlayerSnapshot(
      config,
      state,
      {
        setId: 'ai-cooperative-deadline',
        setPhase: { name: 'gameInProgress', gameIndex: 0 },
        members: seats.map((id) => ({
          id,
          displayName: id,
          isAI: true,
        })),
        setResults: [],
      },
      player,
    );
    const legalPlays = enumerateLegalPlays(config, state, player);
    const ai = createAiPlayer();
    try {
      const partial = await ai.decideMove({
        view,
        legalPlays,
        budget: {
          softMs: 10_000,
          hardMs: 500,
          maxPlayouts: 1_000_000,
          sliceMs: 1,
        },
        seed: 'cooperative-partial',
        difficulty: NORMAL_DIFFICULTY,
      });
      const recovered = await ai.decideMove({
        view,
        legalPlays,
        budget: { softMs: 1, hardMs: 1_000, maxPlayouts: 1, sliceMs: 1 },
        seed: 'cooperative-recovered',
        difficulty: NORMAL_DIFFICULTY,
      });

      expect(partial.usedFallback).toBe('partial-search');
      expect(partial.stats?.worlds).toBeGreaterThan(0);
      expect(
        partial.stats?.candidates.every(
          (candidate) => candidate.visits === partial.stats?.worlds,
        ),
      ).toBe(true);
      expect(recovered.usedFallback).toBe('none');
      expect(recovered.stats?.workerReused).toBe(true);
    } finally {
      await ai.close();
    }
  });

  it('timeout後のworker世代交代が待機中の次ジョブを棄却しない', async () => {
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'ai-worker-generation',
      ruleChain: [],
    };
    const state = startGame(config).state;
    const player = state.public.turn!;
    const context: SnapshotContext = {
      setId: 'ai-worker-generation',
      setPhase: { name: 'gameInProgress', gameIndex: 0 },
      members: seats.map((id) => ({
        id,
        displayName: id,
        isAI: true,
      })),
      setResults: [],
    };
    const base = {
      view: buildPlayerSnapshot(config, state, context, player),
      legalPlays: enumerateLegalPlays(config, state, player),
      seed: 'worker-generation-seed',
      difficulty: NORMAL_DIFFICULTY,
    };
    const ai = createAiPlayer();
    try {
      const first = ai.decideMove({
        ...base,
        budget: {
          softMs: 1_000,
          hardMs: 1,
          maxPlayouts: 1_000,
          sliceMs: 10,
        },
      });
      const second = ai.decideMove({
        ...base,
        budget: {
          softMs: 1,
          hardMs: 1_000,
          maxPlayouts: 1,
          sliceMs: 1,
        },
      });
      const [timedOut, recovered] = await Promise.all([first, second]);

      expect(['heuristic', 'partial-search']).toContain(timedOut.usedFallback);
      expect(recovered.usedFallback).toBe('none');
      expect(recovered.stats?.workerThread).toBe(true);
    } finally {
      await ai.close();
    }
  });

  it('progress受信後のhard timeoutをpartial-searchとして返す', async () => {
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'ai-partial-search',
      ruleChain: [],
    };
    const state = startGame(config).state;
    const player = state.public.turn!;
    const context: SnapshotContext = {
      setId: 'ai-partial-search',
      setPhase: { name: 'gameInProgress', gameIndex: 0 },
      members: seats.map((id) => ({
        id,
        displayName: id,
        isAI: true,
      })),
      setResults: [],
    };
    const pool = new AiWorkerPool(
      new URL('./test-fixtures/partial-worker.js', import.meta.url),
    );
    const ai = createAiPlayer({ pool });
    try {
      const decision = await ai.decideMove({
        view: buildPlayerSnapshot(config, state, context, player),
        legalPlays: enumerateLegalPlays(config, state, player),
        budget: {
          softMs: 50,
          hardMs: 100,
          maxPlayouts: 2_000,
          sliceMs: 10,
        },
        seed: 'partial-search-seed',
        difficulty: NORMAL_DIFFICULTY,
      });

      expect(decision.usedFallback).toBe('partial-search');
      expect(decision.stats?.playouts).toBe(1);
      expect(decision.stats?.workerThread).toBe(true);
    } finally {
      await ai.close();
      await pool.close();
    }
  });

  it('キュー待ち時間をhard deadlineに含める', async () => {
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'ai-queue-deadline',
      ruleChain: [],
    };
    const state = startGame(config).state;
    const player = state.public.turn!;
    const context: SnapshotContext = {
      setId: 'ai-queue-deadline',
      setPhase: { name: 'gameInProgress', gameIndex: 0 },
      members: seats.map((id) => ({
        id,
        displayName: id,
        isAI: true,
      })),
      setResults: [],
    };
    const base = {
      view: buildPlayerSnapshot(config, state, context, player),
      legalPlays: enumerateLegalPlays(config, state, player),
      difficulty: NORMAL_DIFFICULTY,
    };
    const pool = new AiWorkerPool(
      new URL('./test-fixtures/pool-worker.js', import.meta.url),
    );
    const ai = createAiPlayer({ pool });
    try {
      await ai.decideMove({
        ...base,
        seed: 'delay:0',
        budget: { softMs: 1, hardMs: 200, maxPlayouts: 1, sliceMs: 1 },
      });
      const blocking = ai.decideMove({
        ...base,
        seed: 'delay:80',
        budget: { softMs: 1, hardMs: 200, maxPlayouts: 1, sliceMs: 1 },
      });
      const startedAt = performance.now();
      const queued = await ai.decideMove({
        ...base,
        seed: 'delay:0',
        budget: { softMs: 1, hardMs: 20, maxPlayouts: 1, sliceMs: 1 },
      });
      const elapsed = performance.now() - startedAt;

      expect(queued.usedFallback).toBe('heuristic');
      expect(elapsed).toBeLessThan(60);
      await blocking;
    } finally {
      await ai.close();
      await pool.close();
    }
  });

  it('workerがcode 0で予期せず終了しても次ジョブを続行する', async () => {
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'ai-code-zero-exit',
      ruleChain: [],
    };
    const state = startGame(config).state;
    const player = state.public.turn!;
    const context: SnapshotContext = {
      setId: 'ai-code-zero-exit',
      setPhase: { name: 'gameInProgress', gameIndex: 0 },
      members: seats.map((id) => ({
        id,
        displayName: id,
        isAI: true,
      })),
      setResults: [],
    };
    const base = {
      view: buildPlayerSnapshot(config, state, context, player),
      legalPlays: enumerateLegalPlays(config, state, player),
      difficulty: NORMAL_DIFFICULTY,
    };
    const pool = new AiWorkerPool(
      new URL('./test-fixtures/pool-worker.js', import.meta.url),
    );
    const ai = createAiPlayer({ pool });
    try {
      const exited = ai.decideMove({
        ...base,
        seed: 'exit-0',
        budget: { softMs: 1, hardMs: 200, maxPlayouts: 1, sliceMs: 1 },
      });
      const next = ai.decideMove({
        ...base,
        seed: 'delay:0',
        budget: { softMs: 1, hardMs: 200, maxPlayouts: 1, sliceMs: 1 },
      });
      const [failed, recovered] = await Promise.all([exited, next]);

      expect(failed.usedFallback).toBe('heuristic');
      expect(recovered.usedFallback).toBe('none');
      expect(recovered.stats?.workerThread).toBe(true);
    } finally {
      await ai.close();
      await pool.close();
    }
  });

  it('探索例外をheuristicへ落とし、workerを次の着手に再利用する', async () => {
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'ai-search-error',
      ruleChain: [],
    };
    const state = startGame(config).state;
    const player = state.public.turn!;
    const context: SnapshotContext = {
      setId: 'ai-search-error',
      setPhase: { name: 'gameInProgress', gameIndex: 0 },
      members: seats.map((id) => ({
        id,
        displayName: id,
        isAI: true,
      })),
      setResults: [],
    };
    const base = {
      view: buildPlayerSnapshot(config, state, context, player),
      legalPlays: enumerateLegalPlays(config, state, player),
      budget: { softMs: 1, hardMs: 500, maxPlayouts: 1, sliceMs: 1 },
      difficulty: NORMAL_DIFFICULTY,
    };
    const pool = new AiWorkerPool(
      new URL('./test-fixtures/pool-worker.js', import.meta.url),
    );
    const ai = createAiPlayer({ pool });
    try {
      const failed = await ai.decideMove({ ...base, seed: 'error' });
      const recovered = await ai.decideMove({ ...base, seed: 'delay:0' });

      expect(failed.usedFallback).toBe('heuristic');
      expect(
        base.legalPlays.some((play) => sameCandidate(play, failed.play)),
      ).toBe(true);
      expect(recovered.usedFallback).toBe('none');
    } finally {
      await ai.close();
      await pool.close();
    }
  });

  it('worker crashと再生成を12回繰り返しても待機ジョブを失わない', async () => {
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'ai-worker-stress',
      ruleChain: [],
    };
    const state = startGame(config).state;
    const player = state.public.turn!;
    const context: SnapshotContext = {
      setId: 'ai-worker-stress',
      setPhase: { name: 'gameInProgress', gameIndex: 0 },
      members: seats.map((id) => ({
        id,
        displayName: id,
        isAI: true,
      })),
      setResults: [],
    };
    const base = {
      view: buildPlayerSnapshot(config, state, context, player),
      legalPlays: enumerateLegalPlays(config, state, player),
      budget: { softMs: 1, hardMs: 1_000, maxPlayouts: 1, sliceMs: 1 },
      difficulty: NORMAL_DIFFICULTY,
    };
    const pool = new AiWorkerPool(
      new URL('./test-fixtures/pool-worker.js', import.meta.url),
    );
    const ai = createAiPlayer({ pool });
    try {
      for (let cycle = 0; cycle < 12; cycle += 1) {
        const crashed = ai.decideMove({
          ...base,
          seed: 'exit-0',
        });
        const queued = ai.decideMove({
          ...base,
          seed: 'delay:0',
        });
        const [fallback, recovered] = await Promise.all([crashed, queued]);

        expect(fallback.usedFallback).toBe('heuristic');
        expect(recovered.usedFallback).toBe('none');
      }
    } finally {
      await ai.close();
      await pool.close();
    }
  }, 20_000);
});

describe('AI-02 rule following', () => {
  it('worker内でも固定ルールbundleを読み、合法手だけで新ルール有効セットを完走する', async () => {
    const module = ai02RuleFixture as RuleModule;
    const moduleUrl = new URL('./test-fixtures/ai02-rule.js', import.meta.url);
    const bundleHash = createHash('sha256')
      .update(await readFile(moduleUrl))
      .digest('hex');
    const ruleEntry: RuleChainEntry = {
      ruleId: module.meta.ruleId,
      name: module.meta.name,
      position: 0,
      priority: {
        score: 0,
        activatedAt: 0,
        ruleId: module.meta.ruleId,
      },
      bundleHash,
      contractVersion: module.meta.contractVersion,
    };
    const port = createInProcessRuleChainPort([module]);
    let state = startSet(
      {
        setId: 'ai02-rule-set',
        config: { gamesPerSet: 1, interimAutoAdvanceMs: 0 },
        members: seats.map((id) => ({
          id,
          displayName: id,
          isAI: true,
        })),
        ruleChain: [ruleEntry],
        setSeed: 'authority-0',
      },
      port,
    );
    if (!state.currentGame) throw new Error('Expected an active game');
    state = {
      ...state,
      currentGame: {
        ...state.currentGame,
        private: {
          ...state.currentGame.private,
          memory: {
            ...state.currentGame.private.memory,
            [ruleEntry.ruleId]: { force: true },
          },
          hookCalls: {
            ...state.currentGame.private.hookCalls,
            [`${ruleEntry.ruleId}:modifyStrength`]: 7,
          },
        },
      },
    };
    const ai = createAiPlayer({
      search: { cutoffSteps: 4, rootCandidateCap: 4 },
    });
    let actions = 0;
    let workerRuleObserved = false;
    try {
      while (state.phase.name !== 'setResult' && actions < 1_000) {
        if (state.phase.name === 'interimResult') {
          state = reduceSet(state, { type: 'advance' }, port).state;
          actions += 1;
          continue;
        }
        const game = state.currentGame;
        const player = game?.public.turn;
        if (!game || !player) throw new Error('Expected an active AI turn');
        const config: GameConfig = {
          gameIndex: state.phase.gameIndex,
          seats,
          gameSeed: `${state.setSeed}:${state.phase.gameIndex}`,
          ruleChain: [ruleEntry],
        };
        const runtime: RuleRuntime = {
          port,
          setHistory: state.results,
          setMemory: state.setMemory,
        };
        const legal = enumerateLegalPlays(config, game, player, runtime);
        let action: SetAction;
        if (legal.length === 0) {
          action = { type: 'pass', player };
        } else {
          const view = buildPlayerSnapshot(
            config,
            game,
            snapshotContext(state),
            player,
            runtime,
          );
          const decision = await ai.decideMove({
            view,
            legalPlays: legal,
            budget: {
              softMs: 3,
              hardMs: 1_000,
              maxPlayouts: 1,
              sliceMs: 1,
            },
            seed: 'move-0',
            difficulty: NORMAL_DIFFICULTY,
            ruleContext: {
              ruleChain: [ruleEntry],
              bundles: [
                {
                  ruleId: ruleEntry.ruleId,
                  moduleUrl: moduleUrl.href,
                  bundleHash: ruleEntry.bundleHash,
                  contractVersion: ruleEntry.contractVersion,
                  meta: module.meta,
                },
              ],
              gameSeed: config.gameSeed,
              gameMemory: game.private.memory,
              hookCalls: game.private.hookCalls,
              setMemory: state.setMemory,
            },
          });
          expect(decision.usedFallback).toBe('none');
          if (decision.stats?.workerThread) {
            expect(decision.stats.ruleIds).toEqual([ruleEntry.ruleId]);
            expect(view.strengthNote.inverted).toBe(true);
            expect(decision.stats.effectiveStrengthInverted).toBe(
              view.strengthNote.inverted,
            );
            workerRuleObserved = true;
          }
          expect(legal.some((play) => sameCandidate(play, decision.play))).toBe(
            true,
          );
          action = {
            type: 'play',
            player,
            cards: decision.play.cards.map((card) => card.id),
          };
        }
        const transition = reduceSet(state, action, port);
        expect(transition.rejections).toEqual([]);
        state = transition.state;
        actions += 1;
      }
    } finally {
      await ai.close();
    }

    expect(state.phase.name).toBe('setResult');
    expect(state.results).toHaveLength(1);
    expect(state.results[0]?.firedRuleIds).toContain(ruleEntry.ruleId);
    expect(workerRuleObserved).toBe(true);
    expect(actions).toBeLessThan(1_000);
  }, 20_000);

  it('公開cardsMoved履歴から既知カードの現在zoneを権威側と同じに復元する', async () => {
    const module = ai02RuleFixture as RuleModule;
    const moduleUrl = new URL('./test-fixtures/ai02-rule.js', import.meta.url);
    const bundleHash = createHash('sha256')
      .update(await readFile(moduleUrl))
      .digest('hex');
    const ruleEntry: RuleChainEntry = {
      ruleId: module.meta.ruleId,
      name: module.meta.name,
      position: 0,
      priority: {
        score: 0,
        activatedAt: 0,
        ruleId: module.meta.ruleId,
      },
      bundleHash,
      contractVersion: module.meta.contractVersion,
    };
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'ai02-card-move-authority',
      ruleChain: [ruleEntry],
    };
    const started = startGame(config).state;
    const player = started.public.turn;
    if (!player) throw new Error('Expected an opening player');
    const [sourcePlayer, targetPlayer] = seats.filter(
      (candidate) => candidate !== player,
    );
    if (!sourcePlayer || !targetPlayer) {
      throw new Error('Expected two hidden opponents');
    }
    const movedCard = started.players[sourcePlayer]!.hand[0]!;
    if (movedCard.kind !== 'natural') {
      throw new Error('Expected a natural card in a 52-card deck');
    }
    const baseView = buildPlayerSnapshot(
      config,
      started,
      {
        setId: 'ai02-card-move-set',
        setPhase: { name: 'gameInProgress', gameIndex: 0 },
        members: seats.map((id) => ({
          id,
          displayName: id,
          isAI: true,
        })),
        setResults: [],
      },
      player,
    );
    const legalPlays = enumerateLegalPlays(config, started, player);
    expect(legalPlays.length).toBeGreaterThan(1);
    const played = {
      type: 'played' as const,
      player: sourcePlayer,
      play: {
        kind: 'single' as const,
        cards: [movedCard],
        count: 1,
        repRank: movedCard.rank,
      },
    };
    const cleared = {
      type: 'fieldCleared' as const,
      reason: 'rule' as const,
      nextLeader: sourcePlayer,
    };
    const toHand = {
      type: 'cardsMoved' as const,
      by: ruleEntry.ruleId,
      from: { kind: 'discard' as const },
      to: { kind: 'hand' as const, player: targetPlayer },
      count: 1,
      cardIds: [movedCard.id],
    };
    const adjustedPlayers = baseView.players.map((entry) => ({
      ...entry,
      handCount:
        entry.id === sourcePlayer
          ? entry.handCount - 1
          : entry.id === targetPlayer
            ? entry.handCount + 1
            : entry.handCount,
    }));
    const ruleContext = {
      ruleChain: [ruleEntry],
      bundles: [
        {
          ruleId: ruleEntry.ruleId,
          moduleUrl: moduleUrl.href,
          bundleHash,
          contractVersion: ruleEntry.contractVersion,
          meta: module.meta,
        },
      ],
      gameSeed: config.gameSeed,
      gameMemory: {
        [ruleEntry.ruleId]: {
          watchPlayer: targetPlayer,
          watchCard: movedCard.id,
          disableRandom: true,
        },
      },
      hookCalls: started.private.hookCalls,
      setMemory: {},
    };
    const ai = createAiPlayer({
      search: { cutoffSteps: 1, rootCandidateCap: 2 },
    });
    try {
      const common = {
        legalPlays,
        budget: {
          softMs: 3,
          hardMs: 1_000,
          maxPlayouts: 1,
          sliceMs: 1,
        },
        seed: 'ai02-card-move',
        difficulty: NORMAL_DIFFICULTY,
        ruleContext,
      };
      const returnedToHand = await ai.decideMove({
        ...common,
        view: {
          ...baseView,
          field: null,
          discardCount: 0,
          players: adjustedPlayers,
          history: [baseView.history[0]!, played, cleared, toHand],
        },
      });
      const returnedToDiscard = await ai.decideMove({
        ...common,
        view: {
          ...baseView,
          field: null,
          discardCount: 1,
          players: baseView.players.map((entry) => ({
            ...entry,
            handCount:
              entry.id === sourcePlayer ? entry.handCount - 1 : entry.handCount,
          })),
          history: [
            baseView.history[0]!,
            played,
            cleared,
            toHand,
            {
              type: 'cardsMoved',
              by: ruleEntry.ruleId,
              from: { kind: 'hand', player: targetPlayer },
              to: { kind: 'discard' },
              count: 1,
              cardIds: [movedCard.id],
            },
          ],
        },
      });

      expect(returnedToHand.usedFallback).toBe('none');
      expect(returnedToHand.stats?.effectiveStrengthInverted).toBe(true);
      expect(returnedToHand.stats?.simulatedSteps).toBe(
        returnedToHand.stats?.candidateEvaluations,
      );
      expect(returnedToDiscard.usedFallback).toBe('none');
      expect(returnedToDiscard.stats?.effectiveStrengthInverted).toBe(false);
      expect(returnedToDiscard.stats?.simulatedSteps).toBe(
        returnedToDiscard.stats?.candidateEvaluations,
      );
    } finally {
      await ai.close();
    }
  });

  it('bundle実体不一致とworker hook例外を合法heuristic fallbackへ落とす', async () => {
    const module = ai02RuleFixture as RuleModule;
    const moduleUrl = new URL('./test-fixtures/ai02-rule.js', import.meta.url);
    const bundleHash = createHash('sha256')
      .update(await readFile(moduleUrl))
      .digest('hex');
    const ruleEntry: RuleChainEntry = {
      ruleId: module.meta.ruleId,
      name: module.meta.name,
      position: 0,
      priority: {
        score: 0,
        activatedAt: 0,
        ruleId: module.meta.ruleId,
      },
      bundleHash,
      contractVersion: module.meta.contractVersion,
    };
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'ai02-fallback-authority',
      ruleChain: [ruleEntry],
    };
    const port = createInProcessRuleChainPort([module]);
    const started = startGame(config, {
      port,
      setHistory: [],
      setMemory: {},
    }).state;
    const player = started.public.turn;
    if (!player) throw new Error('Expected an opening player');
    const legalPlays = enumerateLegalPlays(config, started, player, {
      port,
      setHistory: [],
      setMemory: {},
    });
    expect(legalPlays.length).toBeGreaterThan(1);
    const view = buildPlayerSnapshot(
      config,
      started,
      {
        setId: 'ai02-fallback-set',
        setPhase: { name: 'gameInProgress', gameIndex: 0 },
        members: seats.map((id) => ({
          id,
          displayName: id,
          isAI: true,
        })),
        setResults: [],
      },
      player,
      { port, setHistory: [], setMemory: {} },
    );
    const baseRuleContext = {
      ruleChain: [ruleEntry],
      bundles: [
        {
          ruleId: ruleEntry.ruleId,
          moduleUrl: moduleUrl.href,
          bundleHash,
          contractVersion: ruleEntry.contractVersion,
          meta: module.meta,
        },
      ],
      gameSeed: config.gameSeed,
      gameMemory: {},
      hookCalls: started.private.hookCalls,
      setMemory: {},
    };
    const ai = createAiPlayer({
      search: { cutoffSteps: 1, rootCandidateCap: 2 },
    });
    try {
      const input = {
        view,
        legalPlays,
        budget: {
          softMs: 3,
          hardMs: 1_000,
          maxPlayouts: 1,
          sliceMs: 1,
        },
        seed: 'ai02-fallback-move',
        difficulty: NORMAL_DIFFICULTY,
      };
      const mismatched = await ai.decideMove({
        ...input,
        ruleContext: {
          ...baseRuleContext,
          ruleChain: [
            {
              ...ruleEntry,
              bundleHash: '0'.repeat(64),
            },
          ],
          bundles: [
            {
              ...baseRuleContext.bundles[0]!,
              bundleHash: '0'.repeat(64),
            },
          ],
        },
      });
      const hookFailed = await ai.decideMove({
        ...input,
        ruleContext: {
          ...baseRuleContext,
          gameMemory: {
            [ruleEntry.ruleId]: { throw: true },
          },
        },
      });
      const recovered = await ai.decideMove({
        ...input,
        ruleContext: {
          ...baseRuleContext,
          gameMemory: {
            [ruleEntry.ruleId]: { force: true },
          },
        },
      });

      expect(mismatched.usedFallback).toBe('heuristic');
      expect(hookFailed.usedFallback).toBe('heuristic');
      expect(recovered.usedFallback).toBe('none');
      expect(recovered.stats?.effectiveStrengthInverted).toBe(true);
    } finally {
      await ai.close();
    }
  });
});
