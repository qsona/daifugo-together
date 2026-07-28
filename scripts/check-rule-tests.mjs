import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const RULE_DIRECTORY = /^r\d{4,}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateRuleTestReport(report) {
  const passed =
    typeof report?.numPassedTests === 'number'
      ? report.numPassedTests
      : Array.isArray(report?.testResults)
        ? report.testResults.reduce(
            (sum, file) =>
              sum +
              (Array.isArray(file?.assertionResults)
                ? file.assertionResults.filter(
                    (assertion) => assertion?.status === 'passed',
                  ).length
                : 0),
            0,
          )
        : 0;
  const pending =
    typeof report?.numPendingTests === 'number'
      ? report.numPendingTests
      : Array.isArray(report?.testResults)
        ? report.testResults.reduce(
            (sum, file) =>
              sum +
              (Array.isArray(file?.assertionResults)
                ? file.assertionResults.filter(
                    (assertion) =>
                      assertion?.status === 'pending' ||
                      assertion?.status === 'skipped' ||
                      assertion?.status === 'todo',
                  ).length
                : 0),
            0,
          )
        : 0;
  return [
    ...(passed < 3
      ? [`rule.test.ts must pass at least 3 tests (actual=${String(passed)})`]
      : []),
    ...(pending > 0
      ? [
          `rule.test.ts must not skip or defer tests (actual=${String(pending)})`,
        ]
      : []),
  ];
}

export function ruleTestFailureMessages(report) {
  if (!Array.isArray(report?.testResults)) return [];
  return report.testResults.flatMap((file) =>
    file?.status === 'failed' && typeof file?.message === 'string'
      ? [file.message]
      : [],
  );
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
    if (!existsSync(join(process.cwd(), 'packages/core/dist/index.js'))) {
      const build = spawnSync('pnpm', ['--filter', '@daifugo/core', 'build'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: 'pipe',
      });
      process.stdout.write(build.stdout ?? '');
      process.stderr.write(build.stderr ?? '');
      if (build.status !== 0) {
        process.exitCode = build.status ?? 1;
        return;
      }
    }
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
      if (existsSync(reportPath)) {
        const report = JSON.parse(readFileSync(reportPath, 'utf8'));
        for (const message of ruleTestFailureMessages(report)) {
          console.error(message);
        }
      }
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
