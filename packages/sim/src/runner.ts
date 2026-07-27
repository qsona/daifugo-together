import {
  buildPlayerSnapshot,
  createSimulationRun,
  createInProcessRuleChainPort,
  samePlay,
  type RuleChainEntry,
  type RuleExecutionIssue,
  type RuleModule,
  type SetAction,
  simulate,
  type SimReport,
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

function entries(modules: readonly RuleModule[]): RuleChainEntry[] {
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
        ruleChain: entries(configuration.modules),
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

const CI_AI_BUDGET: ThinkBudget = {
  softMs: 3,
  hardMs: 500,
  maxPlayouts: 1,
  sliceMs: 1,
};

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
      const ruleChain = entries(
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
      const ai = createAiPlayer({
        search: { cutoffSteps: 4, rootCandidateCap: 4 },
      });
      let moves = 0;
      let fallbacks = 0;
      let playouts = 0;
      let maxMoveWallMs = 0;
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
          if (decision.legalPlays.length === 0) {
            action = { type: 'pass', player: decision.player };
          } else {
            const startedAt = performance.now();
            const result = await ai.decideMove({
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
              budget: options.budget ?? CI_AI_BUDGET,
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
            });
            const wallMs = performance.now() - startedAt;
            maxMoveWallMs = Math.max(maxMoveWallMs, wallMs);
            moves += 1;
            playouts += result.stats?.playouts ?? 0;
            if (result.usedFallback !== 'none') fallbacks += 1;
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
        const wallLimit = options.maxMoveWallMs ?? CI_AI_BUDGET.hardMs + 100;
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
