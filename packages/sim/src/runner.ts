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
  type SetAction,
  type SetState,
  simulate,
  type SimReport,
  type TrustedSimulationRulePlan,
} from '@daifugo/core';
import {
  createAiPlayer,
  NORMAL_DIFFICULTY,
  type AiFallback,
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

export type SimulationConfiguration = SimulationRun['configuration'];

function configurations<T>(options: {
  newOnly: T;
  all: T;
  selected?: readonly SimulationConfiguration[];
}): { name: SimulationConfiguration; value: T }[] {
  const selected = options.selected ?? ['new-only', 'all'];
  return selected.map((name) => ({
    name,
    value: name === 'new-only' ? options.newOnly : options.all,
  }));
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
  newRuleId?: string;
  games: number;
  seeds: number;
  configurations?: readonly SimulationConfiguration[];
}): SimulationRun[] {
  const selected = options.configurations ?? ['new-only', 'all'];
  const newRule =
    options.newRuleId === undefined
      ? undefined
      : options.modules.find(
          (module) => module.meta.ruleId === options.newRuleId,
        );
  if (selected.includes('new-only') && !newRule) {
    throw new Error(`new rule was not loaded: ${String(options.newRuleId)}`);
  }
  const selectedConfigurations = configurations({
    newOnly: newRule ? [newRule] : [],
    all: [...options.modules],
    selected,
  }).map(({ name, value }) => ({ name, modules: value }));
  const runs: SimulationRun[] = [];
  for (const configuration of selectedConfigurations) {
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

function compactValue(value: unknown): string {
  const serialized = JSON.stringify(value);
  return (serialized ?? String(value)).slice(0, 160);
}

function firstStructuralDifference(
  left: unknown,
  right: unknown,
  path = '$',
): string {
  if (Object.is(left, right)) return '';
  if (
    typeof left !== 'object' ||
    left === null ||
    typeof right !== 'object' ||
    right === null
  ) {
    return `${path}: ${compactValue(left)} !== ${compactValue(right)}`;
  }
  if (Array.isArray(left) !== Array.isArray(right)) {
    return `${path}: array/object shape differs`;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    for (
      let index = 0;
      index < Math.min(left.length, right.length);
      index += 1
    ) {
      const difference = firstStructuralDifference(
        left[index],
        right[index],
        `${path}[${String(index)}]`,
      );
      if (difference) return difference;
    }
    if (left.length === right.length) return '';
    return `${path}.length: ${String(left.length)} !== ${String(
      right.length,
    )}; extra ${compactValue(
      left.length > right.length
        ? left.slice(right.length)
        : right.slice(left.length),
    )}`;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  if (
    leftKeys.length !== rightKeys.length ||
    leftKeys.some((key, index) => key !== rightKeys[index])
  ) {
    return `${path}: ${compactValue(left)} !== ${compactValue(right)}`;
  }
  for (const key of leftKeys) {
    const difference = firstStructuralDifference(
      leftRecord[key],
      rightRecord[key],
      Array.isArray(left) ? `${path}[${key}]` : `${path}.${key}`,
    );
    if (difference) return difference;
  }
  return '';
}

function differentialSimulationProblem(input: {
  config: GameConfig;
  game: GameState;
  state: SetState;
  player: string;
  modules: readonly RuleModule[];
  trustedPlan: TrustedSimulationRulePlan;
  move: number;
}): string | undefined {
  const snapshotContext = {
    setId: input.state.setId,
    setPhase: input.state.phase,
    members: input.state.members,
    setResults: input.state.results,
  };
  const safePort = createInProcessRuleChainPort(input.modules);
  const fastPort = createTrustedSimulationRuleChainPort(input.trustedPlan);
  const safe = createSimulationApi({
    config: input.config,
    snapshotContext,
    runtime: {
      port: safePort,
      setHistory: input.state.results,
      setMemory: input.state.setMemory,
    },
  });
  const fast = createSimulationApi({
    config: input.config,
    snapshotContext,
    runtime: {
      port: fastPort,
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
  const legalDifference = firstStructuralDifference(fastLegal, safeLegal);
  if (legalDifference) {
    return `legal plays or strength differ at ${legalDifference}`;
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
    const resultDifference = firstStructuralDifference(fastResult, safeResult);
    return resultDifference
      ? `applied transition differs at ${resultDifference}`
      : undefined;
  } catch (error) {
    return `differential apply failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export const CI_AI_HARD_MS = 2_000;

const CI_AI_BUDGET: ThinkBudget = {
  softMs: 50,
  hardMs: CI_AI_HARD_MS,
  maxPlayouts: 64,
  sliceMs: 10,
};
const CI_AI_WARMUP_BUDGET: ThinkBudget = {
  ...CI_AI_BUDGET,
};
export function isAiCompatibilityFailure(fallback: AiFallback): boolean {
  return fallback !== 'none' && fallback !== 'partial-search';
}

export async function runAiRuleSimulations(options: {
  bundles: readonly LoadedRuleBundle[];
  newRuleId?: string;
  games: number;
  seeds: number;
  configurations?: readonly SimulationConfiguration[];
  budget?: ThinkBudget;
}): Promise<SimulationRun[]> {
  const selected = options.configurations ?? ['new-only', 'all'];
  const newRule =
    options.newRuleId === undefined
      ? undefined
      : options.bundles.find(
          (bundle) => bundle.module.meta.ruleId === options.newRuleId,
        );
  if (selected.includes('new-only') && !newRule) {
    throw new Error(`new rule was not loaded: ${String(options.newRuleId)}`);
  }
  const selectedConfigurations = configurations({
    newOnly: newRule ? [newRule] : [],
    all: [...options.bundles],
    selected,
  }).map(({ name, value }) => ({ name, bundles: value }));
  const runs: SimulationRun[] = [];
  for (const configuration of selectedConfigurations) {
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
      const trustedPlans = new Map<string, TrustedSimulationRulePlan>();
      const ai = createAiPlayer({
        // 本番と同じ先読み長で、ルール下でもAIが合法手を返せるか確認する。
        search: { cutoffSteps: 65 },
      });
      let moves = 0;
      let fallbacks = 0;
      let incompatibleFallbacks = 0;
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
          const disabledRuleIds = new Set(
            decision.runtime.port.disabledRuleIds?.() ?? [],
          );
          const activeRuleChain = ruleChain.filter(
            (entry) => !disabledRuleIds.has(entry.ruleId),
          );
          const activeRuleIds = new Set(
            activeRuleChain.map((entry) => entry.ruleId),
          );
          const activeBundles = configuration.bundles.filter((bundle) =>
            activeRuleIds.has(bundle.module.meta.ruleId),
          );
          const activeConfig = {
            ...decision.config,
            ruleChain: activeRuleChain,
          };
          const trustedPlanKey = activeRuleChain
            .map((entry) => entry.ruleId)
            .join('\0');
          let trustedPlan = trustedPlans.get(trustedPlanKey);
          if (!trustedPlan) {
            trustedPlan = compileTrustedSimulationRulePlan(
              activeRuleChain,
              activeBundles.map((bundle) => bundle.module),
            );
            trustedPlans.set(trustedPlanKey, trustedPlan);
          }
          let action: SetAction;
          const differentialProblem = differentialSimulationProblem({
            config: activeConfig,
            game,
            state: decision.state,
            player: decision.player,
            modules: activeBundles.map((bundle) => bundle.module),
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
                activeConfig,
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
                ruleChain: activeRuleChain,
                bundles: activeBundles.map((bundle) => ({
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
            if (isAiCompatibilityFailure(result.usedFallback)) {
              incompatibleFallbacks += 1;
            }
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
        if (incompatibleFallbacks > 0) {
          report.invariantViolations.push({
            game: -1,
            invariant: 'ai-fallback',
            detail: `${String(incompatibleFallbacks)}/${String(moves)} AI moves used heuristic or engine fallback`,
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
