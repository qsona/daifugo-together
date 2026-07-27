import {
  createInProcessRuleChainPort,
  type RuleChainEntry,
  type RuleExecutionIssue,
  type RuleModule,
  simulate,
  type SimReport,
} from '@daifugo/core';

export interface SimulationRun {
  configuration: 'new-only' | 'all';
  seed: string;
  report: SimReport;
  executionIssues: RuleExecutionIssue[];
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
