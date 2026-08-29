import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadRuleBundles } from './loader.js';
import {
  runAiRuleSimulations,
  simulationViolations,
  type SimulationConfiguration,
} from './runner.js';

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

export function defaultRulesRoot(moduleUrl = import.meta.url): string {
  return resolve(dirname(fileURLToPath(moduleUrl)), '../../rules');
}

async function main(): Promise<void> {
  const configurations = simulationConfigurations(argument('--configuration'));
  const newRuleId = argument('--rule');
  if (configurations.includes('new-only') && !newRuleId) {
    throw new Error(
      'usage: sim [--rule r0001-slug] [--configuration both|new-only|all] [--games 200] [--seeds 5] [--rules-root packages/rules]; --rule is required for new-only',
    );
  }
  const rulesRoot = resolve(argument('--rules-root') ?? defaultRulesRoot());
  const games = positiveInteger('--games', 200);
  const seeds = positiveInteger('--seeds', 5);
  const bundles = await loadRuleBundles({
    rulesRoot,
    ...(newRuleId === undefined ? {} : { newRuleId }),
  });
  const runs = await runAiRuleSimulations({
    bundles,
    ...(newRuleId === undefined ? {} : { newRuleId }),
    games,
    seeds,
    configurations,
  });
  const violations = simulationViolations(runs);
  process.stdout.write(
    `${JSON.stringify({ ...(newRuleId ? { newRuleId } : {}), games, seeds, runs, violations })}\n`,
  );
  if (violations.length > 0) process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
