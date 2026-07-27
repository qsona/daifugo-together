import { resolve } from 'node:path';

import { loadRuleBundles } from './loader.js';
import { runAiRuleSimulations, simulationViolations } from './runner.js';

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

async function main(): Promise<void> {
  const newRuleId = argument('--rule');
  if (!newRuleId) {
    throw new Error(
      'usage: sim --rule r0001-slug [--games 200] [--seeds 5] [--rules-root packages/rules]',
    );
  }
  const rulesRoot = resolve(argument('--rules-root') ?? 'packages/rules');
  const games = positiveInteger('--games', 200);
  const seeds = positiveInteger('--seeds', 5);
  const bundles = await loadRuleBundles({ rulesRoot, newRuleId });
  const runs = await runAiRuleSimulations({
    bundles,
    newRuleId,
    games,
    seeds,
  });
  const violations = simulationViolations(runs);
  process.stdout.write(
    `${JSON.stringify({ newRuleId, games, seeds, runs, violations })}\n`,
  );
  if (violations.length > 0) process.exitCode = 1;
}

await main();
