import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VERSION_FILE = 'packages/rules/rule-versions.json';
const RULE_SOURCE =
  /^packages\/rules\/(r\d{4,}-[a-z0-9]+(?:-[a-z0-9]+)*)\/rule\.ts$/u;

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function versionsAt(cwd, ref) {
  try {
    const parsed = JSON.parse(git(cwd, 'show', `${ref}:${VERSION_FILE}`));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

export function validateRuleVersionBumps({ cwd, base, head }) {
  const changedPaths = git(
    cwd,
    'diff',
    '--name-only',
    '--diff-filter=M',
    base,
    head,
    '--',
    'packages/rules',
  )
    .split('\n')
    .filter(Boolean);
  const baseVersions = versionsAt(cwd, base);
  const headVersions = versionsAt(cwd, head);
  const violations = [];

  for (const path of changedPaths) {
    const match = RULE_SOURCE.exec(path);
    if (!match) continue;
    const ruleId = match[1];
    const baseVersion = baseVersions[ruleId] ?? 1;
    const headVersion = headVersions[ruleId] ?? 1;
    if (
      !Number.isSafeInteger(baseVersion) ||
      !Number.isSafeInteger(headVersion) ||
      headVersion <= baseVersion
    ) {
      violations.push({ ruleId, path, baseVersion, headVersion });
    }
  }

  return violations;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cwd = process.cwd();
  const base = argument('--base') ?? process.env.RULE_VERSION_DIFF_BASE;
  const head =
    argument('--head') ?? process.env.RULE_VERSION_DIFF_HEAD ?? 'HEAD';
  if (!base) {
    throw new Error(
      'rule version check requires --base or RULE_VERSION_DIFF_BASE',
    );
  }

  const violations = validateRuleVersionBumps({ cwd, base, head });
  if (violations.length > 0) {
    for (const { ruleId, path, baseVersion, headVersion } of violations) {
      console.error(
        `${path} changed without increasing ${ruleId} in ${VERSION_FILE} ` +
          `(base=${String(baseVersion)}, head=${String(headVersion)})`,
      );
    }
    process.exitCode = 1;
  }
}
