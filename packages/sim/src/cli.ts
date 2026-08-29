import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadRuleBundles } from './loader.js';
import {
  runAiRuleSimulations,
  runRuleSimulations,
  simulationViolations,
  type SimulationConfiguration,
} from './runner.js';

export type SimulationMode = 'invariants' | 'ai-smoke';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function positiveInteger(name: string, fallback: number): number {
  const raw = argument(name);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}

export function simulationConfigurations(
  value: string | undefined,
): readonly SimulationConfiguration[] {
  switch (value ?? 'both') {
    case 'both':
      return ['new-only', 'all'];
    case 'new-only':
      return ['new-only'];
    case 'all':
      return ['all'];
    default:
      throw new Error('--configuration must be both, new-only, or all');
  }
}

export function simulationMode(value: string | undefined): SimulationMode {
  switch (value ?? 'ai-smoke') {
    case 'invariants':
      return 'invariants';
    case 'ai-smoke':
      return 'ai-smoke';
    default:
      throw new Error('--mode must be invariants or ai-smoke');
  }
}

export function defaultRulesRoot(moduleUrl = import.meta.url): string {
  return resolve(dirname(fileURLToPath(moduleUrl)), '../../rules');
}

async function main(): Promise<void> {
  const mode = simulationMode(argument('--mode'));
  const configurations = simulationConfigurations(argument('--configuration'));
  const newRuleId = argument('--rule');
  if (configurations.includes('new-only') && !newRuleId) {
    throw new Error(
      'usage: sim [--mode invariants|ai-smoke] [--rule r0001-slug] [--configuration both|new-only|all] [--games 200] [--seeds 5] [--rules-root packages/rules]; --rule is required for new-only',
    );
  }
  const rulesRoot = resolve(argument('--rules-root') ?? defaultRulesRoot());
  const games = positiveInteger('--games', 200);
  const seeds = positiveInteger('--seeds', 5);
  const bundles = await loadRuleBundles({
    rulesRoot,
    ...(newRuleId === undefined ? {} : { newRuleId }),
  });
  const commonOptions = {
    ...(newRuleId === undefined ? {} : { newRuleId }),
    games,
    seeds,
    configurations,
  };
  const runs =
    mode === 'invariants'
      ? runRuleSimulations({
          ...commonOptions,
          modules: bundles.map((bundle) => bundle.module),
        })
      : await runAiRuleSimulations({ bundles, ...commonOptions });
  const violations = simulationViolations(runs);
  process.stdout.write(
    `${JSON.stringify({ mode, ...(newRuleId ? { newRuleId } : {}), games, seeds, runs, violations })}\n`,
  );
  if (violations.length > 0) process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
