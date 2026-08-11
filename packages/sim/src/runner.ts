import {
  buildPlayerSnapshot,
  compileTrustedSimulationRulePlan,
  createSimulationApi,
  createSimulationRun,
  createInProcessRuleChainPort,
  createTrustedSimulationRuleChainPort,
  samePlay,
  type GameConfig,
  type GameState,
  type RuleChainEntry,
  type RuleExecutionIssue,
  type RuleModule,
  type RuleRuntime,
  type SetAction,
  type SetState,
  simulate,
  type SimReport,
  type TrustedSimulationRulePlan,
} from '@daifugo/core';
import {
  createAiPlayer,
  NORMAL_DIFFICULTY,
  type ThinkBudget,
} from '@daifugo/ai';

import type { LoadedRuleBundle } from './loader.js';

export interface SimulationRun {
  configuration: 'new-only' | 'all';
  seed: string;
  report: SimReport;
  executionIssues: RuleExecutionIssue[];
  aiStats?: {
    moves: number;
    meanPlayoutsPerMove: number;
    fallbackRate: number;
    maxMoveWallMs: number;
  };
}

export function ruleChainEntries(
  modules: readonly RuleModule[],
): RuleChainEntry[] {
  return modules.map((module, index) => ({
    ruleId: module.meta.ruleId,
    name: module.meta.name,
    position: index,
    priority: {
      score: 0,
      activatedAt: 0,
      ruleId: module.meta.ruleId,
    },
    bundleHash: `ci-${module.meta.ruleId}`,
    contractVersion: module.meta.contractVersion,
    // meta の宣言を entry へ転記する(engineFeaturesOf が参照する)。
    // 未宣言は省略し、既存の entry 形を変えない。
    ...((module.meta.engineFeatures?.length ?? 0) > 0
      ? { engineFeatures: [...module.meta.engineFeatures!] }
      : {}),
  }));
}

export function runRuleSimulations(options: {
  modules: readonly RuleModule[];
  newRuleId: string;
  games: number;
  seeds: number;
}): SimulationRun[] {
  const newRule = options.modules.find(
    (module) => module.meta.ruleId === options.newRuleId,
  );
  if (!newRule)
    throw new Error(`new rule was not loaded: ${options.newRuleId}`);
  const configurations = [
    { name: 'new-only' as const, modules: [newRule] },
    { name: 'all' as const, modules: [...options.modules] },
  ];
  const runs: SimulationRun[] = [];
  for (const configuration of configurations) {
    for (let seed = 0; seed < options.seeds; seed += 1) {
      const executionIssues: RuleExecutionIssue[] = [];
      const report = simulate({
        games: options.games,
        gamesPerSet: 1,
        seed: `cx03:${configuration.name}:${String(seed)}`,
        ruleChain: ruleChainEntries(configuration.modules),
        port: createInProcessRuleChainPort(configuration.modules, {
          onIssue: (issue) => executionIssues.push(issue),
        }),
      });
      runs.push({
        configuration: configuration.name,
        seed: String(seed),
        report,
        executionIssues,
      });
    }
  }
  return runs;
}

function differentialSimulationProblem(input: {
  config: GameConfig;
  game: GameState;
  state: SetState;
  player: string;
  safeRuntime: RuleRuntime;
  trustedPlan: TrustedSimulationRulePlan;
  move: number;
}): string | undefined {
  const snapshotContext = {
    setId: input.state.setId,
    setPhase: input.state.phase,
    members: input.state.members,
    setResults: input.state.results,
  };
  const safe = createSimulationApi({
    config: input.config,
    snapshotContext,
    runtime: input.safeRuntime,
  });
  const fast = createSimulationApi({
    config: input.config,
    snapshotContext,
    runtime: {
      port: createTrustedSimulationRuleChainPort(input.trustedPlan),
      setHistory: input.state.results,
      setMemory: input.state.setMemory,
    },
  });
  const safePosition = safe.createPosition(input.game, input.state.setMemory);
  const fastPosition = fast.createPosition(input.game, input.state.setMemory);
  const safeLegal = safe.enumerateLegalPlaysWithStrength(
    safePosition,
    input.player,
  );
  const fastLegal = fast.enumerateLegalPlaysWithStrength(
    fastPosition,
    input.player,
  );
  if (JSON.stringify(fastLegal) !== JSON.stringify(safeLegal)) {
    return 'legal plays or strength differ';
  }
  const selected = safeLegal.plays[input.move % safeLegal.plays.length];
  const action = selected
    ? {
        type: 'play' as const,
        player: input.player,
        cards: selected.cards.map((card) => card.id),
      }
    : { type: 'pass' as const, player: input.player };
  try {
    const safeResult = safe.applyPlay(safePosition, action);
    const fastResult = fast.applyPlay(fastPosition, action);
    return JSON.stringify(fastResult) === JSON.stringify(safeResult)
      ? undefined
      : 'applied transition differs';
  } catch (error) {
    return `differential apply failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

const CI_AI_BUDGET: ThinkBudget = {
  softMs: 50,
  hardMs: 200,
  maxPlayouts: 64,
  sliceMs: 10,
};
const CI_AI_WARMUP_BUDGET: ThinkBudget = {
  ...CI_AI_BUDGET,
  hardMs: 2_000,
};
const CI_MAX_MOVE_WALL_MS = 200;

export async function runAiRuleSimulations(options: {
  bundles: readonly LoadedRuleBundle[];
  newRuleId: string;
  games: number;
  seeds: number;
  budget?: ThinkBudget;
  maxMoveWallMs?: number;
}): Promise<SimulationRun[]> {
  const newRule = options.bundles.find(
    (bundle) => bundle.module.meta.ruleId === options.newRuleId,
  );
  if (!newRule)
    throw new Error(`new rule was not loaded: ${options.newRuleId}`);
  const configurations = [
    { name: 'new-only' as const, bundles: [newRule] },
    { name: 'all' as const, bundles: [...options.bundles] },
  ];
  const runs: SimulationRun[] = [];
  for (const configuration of configurations) {
    for (let seed = 0; seed < options.seeds; seed += 1) {
      const executionIssues: RuleExecutionIssue[] = [];
      const ruleChain = ruleChainEntries(
        configuration.bundles.map((bundle) => bundle.module),
      ).map((entry) => {
        const bundle = configuration.bundles.find(
          (candidate) => candidate.module.meta.ruleId === entry.ruleId,
        )!;
        return { ...entry, bundleHash: bundle.bundleHash };
      });
      const port = createInProcessRuleChainPort(
        configuration.bundles.map((bundle) => bundle.module),
        { onIssue: (issue) => executionIssues.push(issue) },
      );
      const simulation = createSimulationRun({
        games: options.games,
        gamesPerSet: 1,
        seed: `ai02:${configuration.name}:${String(seed)}`,
        ruleChain,
        port,
      });
      const trustedPlan = compileTrustedSimulationRulePlan(
        ruleChain,
        configuration.bundles.map((bundle) => bundle.module),
      );
      const ai = createAiPlayer({
        // CIも本番と同じ先読み長で、ルール実行の性能退行を検出する。
        search: { cutoffSteps: 24 },
      });
      let moves = 0;
      let fallbacks = 0;
      let playouts = 0;
      let maxMoveWallMs = 0;
      let workerWarmedUp = false;
      const policyViolations: SimReport['invariantViolations'] = [];
      let step = simulation.next();
      try {
        while (!step.done) {
          const decision = step.value;
          const game = decision.state.currentGame;
          if (!game) {
            throw new Error('AI simulation has no active game');
          }
          let action: SetAction;
          const differentialProblem = differentialSimulationProblem({
            config: decision.config,
            game,
            state: decision.state,
            player: decision.player,
            safeRuntime: decision.runtime,
            trustedPlan,
            move: moves,
          });
          if (differentialProblem) {
            policyViolations.push({
              game: decision.setIndex,
              invariant: 'ai-safe-fast-differential',
              detail: differentialProblem,
            });
          }
          if (decision.legalPlays.length === 0) {
            action = { type: 'pass', player: decision.player };
          } else {
            const input = {
              view: buildPlayerSnapshot(
                decision.config,
                game,
                {
                  setId: decision.state.setId,
                  setPhase: decision.state.phase,
                  members: decision.state.members,
                  setResults: decision.state.results,
                },
                decision.player,
                decision.runtime,
              ),
              legalPlays: decision.legalPlays,
              seed: `ai02:${configuration.name}:${String(seed)}:${String(
                moves,
              )}:${decision.player}`,
              difficulty: NORMAL_DIFFICULTY,
              ruleContext: {
                ruleChain,
                bundles: configuration.bundles.map((bundle) => ({
                  ruleId: bundle.module.meta.ruleId,
                  moduleUrl: bundle.moduleUrl,
                  bundleHash: bundle.bundleHash,
                  contractVersion: bundle.module.meta.contractVersion,
                  meta: structuredClone(bundle.module.meta),
                })),
                gameSeed: decision.config.gameSeed,
                gameMemory: structuredClone(game.private.memory),
                hookCalls: structuredClone(game.private.hookCalls),
                setMemory: structuredClone(decision.state.setMemory),
              },
            };
            if (!workerWarmedUp && decision.legalPlays.length > 1) {
              const warmup = await ai.decideMove({
                ...input,
                budget: CI_AI_WARMUP_BUDGET,
                seed: `${input.seed}:warmup`,
              });
              if (warmup.usedFallback !== 'none') {
                throw new Error(
                  `AI worker warmup used fallback: ${warmup.usedFallback}`,
                );
              }
              workerWarmedUp = true;
            }
            const startedAt = performance.now();
            const result = await ai.decideMove({
              ...input,
              budget: options.budget ?? CI_AI_BUDGET,
            });
            const wallMs = performance.now() - startedAt;
            maxMoveWallMs = Math.max(maxMoveWallMs, wallMs);
            moves += 1;
            playouts += result.stats?.playouts ?? 0;
            if (result.usedFallback !== 'none') fallbacks += 1;
            if (
              result.stats?.workerThread &&
              result.stats.rootCandidates !== decision.legalPlays.length
            ) {
              policyViolations.push({
                game: decision.setIndex,
                invariant: 'ai-root-candidates',
                detail: `${String(result.stats.rootCandidates)} evaluated for ${String(decision.legalPlays.length)} legal plays`,
              });
            }
            if (
              result.stats?.workerThread &&
              result.stats.candidates.some(
                (candidate) => candidate.visits !== result.stats?.worlds,
              )
            ) {
              policyViolations.push({
                game: decision.setIndex,
                invariant: 'ai-incomplete-world',
                detail:
                  'root candidates were evaluated a different number of times',
              });
            }
            const authoritative = decision.legalPlays.find((play) =>
              samePlay(play, result.play),
            );
            if (!authoritative) {
              policyViolations.push({
                game: decision.setIndex,
                invariant: 'ai-illegal-play',
                detail: `${decision.player} returned a play outside authority legalPlays`,
              });
            }
            const selected = authoritative ?? decision.legalPlays[0]!;
            action = {
              type: 'play',
              player: decision.player,
              cards: selected.cards.map((card) => card.id),
            };
          }
          step = simulation.next(action);
        }
        const report = step.value;
        report.invariantViolations.push(...policyViolations);
        if (fallbacks > 0) {
          report.invariantViolations.push({
            game: -1,
            invariant: 'ai-fallback',
            detail: `${String(fallbacks)}/${String(moves)} AI moves used fallback`,
          });
        }
        const wallLimit = options.maxMoveWallMs ?? CI_MAX_MOVE_WALL_MS;
        if (maxMoveWallMs > wallLimit) {
          report.invariantViolations.push({
            game: -1,
            invariant: 'ai-timeout',
            detail: `max move wall ${maxMoveWallMs.toFixed(1)}ms > ${String(
              wallLimit,
            )}ms`,
          });
        }
        runs.push({
          configuration: configuration.name,
          seed: String(seed),
          report,
          executionIssues,
          aiStats: {
            moves,
            meanPlayoutsPerMove: moves === 0 ? 0 : playouts / moves,
            fallbackRate: moves === 0 ? 0 : fallbacks / moves,
            maxMoveWallMs,
          },
        });
      } finally {
        await ai.close();
      }
    }
  }
  return runs;
}

export function simulationViolations(runs: readonly SimulationRun[]): string[] {
  return runs.flatMap((run) => {
    const prefix = `${run.configuration}/seed-${run.seed}`;
    return [
      ...(run.report.completed === 0 ? [`${prefix}: no set completed`] : []),
      ...run.report.invariantViolations.map(
        (violation) => `${prefix}: ${violation.invariant}: ${violation.detail}`,
      ),
      ...run.executionIssues.map(
        (issue) => `${prefix}: ${issue.ruleId}/${issue.hook}: ${issue.reason}`,
      ),
    ];
  });
}
