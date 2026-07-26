import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const RULES_PREFIX = 'packages/rules/';

export function changedPaths({ base, head, cwd = process.cwd() }) {
  const output = execFileSync(
    'git',
    ['diff', '--name-only', '--no-renames', '-z', `${base}...${head}`],
    {
      cwd,
      encoding: 'utf8',
    },
  );

  return output.split('\0').filter(Boolean);
}

export function validateRuleOnlyPaths(paths) {
  if (paths.length === 0) {
    return ['差分がありません。'];
  }

  return paths
    .filter((path) => !path.startsWith(RULES_PREFIX))
    .map((path) => `${path}: ${RULES_PREFIX} 配下ではありません。`);
}

export function checkRuleDiff(options) {
  const paths = changedPaths(options);
  return {
    paths,
    violations: validateRuleOnlyPaths(paths),
  };
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function main() {
  const base = argumentValue('--base') ?? process.env.RULE_DIFF_BASE;
  const head = argumentValue('--head') ?? process.env.RULE_DIFF_HEAD;

  if (!base || !head) {
    console.error(
      '使い方: node scripts/check-rule-diff.mjs --base <base-ref> --head <head-ref>',
    );
    process.exitCode = 2;
    return;
  }

  const { paths, violations } = checkRuleDiff({ base, head });
  console.log('検査対象の変更ファイル:');
  for (const path of paths) {
    console.log(`- ${path}`);
  }

  if (violations.length > 0) {
    console.error('ルール PR の差分ガードに違反しています:');
    for (const violation of violations) {
      console.error(`- ${violation}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`差分ガード通過: 変更はすべて ${RULES_PREFIX} 配下です。`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
