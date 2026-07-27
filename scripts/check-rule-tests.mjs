import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const RULE_DIRECTORY = /^r\d{4,}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateRuleTestReport(report) {
  const total =
    typeof report?.numTotalTests === 'number'
      ? report.numTotalTests
      : Array.isArray(report?.testResults)
        ? report.testResults.reduce(
            (sum, file) =>
              sum +
              (Array.isArray(file?.assertionResults)
                ? file.assertionResults.length
                : 0),
            0,
          )
        : 0;
  return total >= 3
    ? []
    : [`rule.test.ts must execute at least 3 tests (actual=${String(total)})`];
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function main() {
  const directory = argument('--rule') ?? process.env.RULE_DIRECTORY;
  const rulesRoot = argument('--rules-root') ?? 'packages/rules';
  if (!directory || !RULE_DIRECTORY.test(directory)) {
    console.error('usage: check-rule-tests --rule r0001-slug');
    process.exitCode = 2;
    return;
  }
  const outputRoot = mkdtempSync(join(tmpdir(), 'rule-tests-'));
  const reportPath = join(outputRoot, 'report.json');
  const ruleRoot = `${rulesRoot}/${directory}`;
  try {
    const result = spawnSync(
      'pnpm',
      [
        'exec',
        'vitest',
        'run',
        `${ruleRoot}/rule.test.ts`,
        '--reporter=json',
        `--outputFile=${reportPath}`,
        '--coverage.enabled=true',
        '--coverage.provider=v8',
        `--coverage.include=${ruleRoot}/rule.ts`,
        '--coverage.reporter=text',
        '--coverage.thresholds.lines=70',
      ],
      { cwd: process.cwd(), encoding: 'utf8', stdio: 'pipe' },
    );
    process.stdout.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      return;
    }
    const violations = validateRuleTestReport(
      JSON.parse(readFileSync(reportPath, 'utf8')),
    );
    if (violations.length > 0) {
      for (const violation of violations) console.error(violation);
      process.exitCode = 1;
    }
  } finally {
    rmSync(outputRoot, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
