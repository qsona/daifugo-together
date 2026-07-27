import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const RULE_PATH =
  /^packages\/rules\/(r\d{4,}-[a-z0-9]+(?:-[a-z0-9]+)*)\/(rule\.ts|rule\.test\.ts|meta\.json|SPEC\.json)$/;
const SCAFFOLD_FILES = ['meta.json', 'SPEC.json'];
const GENERATED_FILES = ['rule.ts', 'rule.test.ts'];

function git(cwd, args, options = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function gitExitCode(cwd, args) {
  try {
    git(cwd, args);
    return 0;
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'status' in error &&
      typeof error.status === 'number'
    ) {
      return error.status;
    }
    throw error;
  }
}

export function changedEntries({ base, head, cwd = process.cwd() }) {
  const output = git(cwd, [
    'diff',
    '--name-status',
    '--no-renames',
    '-z',
    `${base}...${head}`,
  ]);
  const fields = output.split('\0').filter(Boolean);
  const entries = [];
  for (let index = 0; index < fields.length; index += 2) {
    const status = fields[index];
    const path = fields[index + 1];
    if (!status || !path) {
      throw new Error('git diff returned an incomplete name-status record');
    }
    entries.push({ status, path });
  }
  return entries;
}

export function scaffoldShaFromBody(body) {
  const blocks = [
    ...body.matchAll(
      /<!-- daifugo-pipeline\s+([\s\S]*?)\s+end-daifugo-pipeline -->/g,
    ),
  ];
  if (blocks.length !== 1) return null;
  const matches = [
    ...blocks[0][1].matchAll(
      /(?:^|\n)scaffold-sha:\s*([0-9a-f]{40,64})\s*(?=\n|$)/g,
    ),
  ];
  return matches.length === 1 ? matches[0][1] : null;
}

function validateMeta(meta, directory) {
  const violations = [];
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return ['meta.json: objectではありません。'];
  }
  const requiredStrings = ['ruleId', 'name', 'description', 'proposalId'];
  for (const key of requiredStrings) {
    if (typeof meta[key] !== 'string' || meta[key].trim() === '') {
      violations.push(`meta.json: ${key} は空でないstringが必要です。`);
    }
  }
  if (meta.ruleId !== directory) {
    violations.push(
      `meta.json: ruleId ${String(meta.ruleId)} がdirectory ${directory} と一致しません。`,
    );
  }
  if (meta.kind !== 'local' && meta.kind !== 'original') {
    violations.push('meta.json: kind は local または original が必要です。');
  }
  if (meta.contractVersion !== 1) {
    violations.push('meta.json: contractVersion は 1 が必要です。');
  }
  if (
    meta.prefecture !== undefined &&
    (meta.kind !== 'local' ||
      typeof meta.prefecture !== 'string' ||
      meta.prefecture.trim() === '')
  ) {
    violations.push(
      'meta.json: prefecture はlocal時の空でないstringだけ許可します。',
    );
  }
  if (
    !meta.messages ||
    typeof meta.messages !== 'object' ||
    Array.isArray(meta.messages) ||
    Object.values(meta.messages).some((value) => typeof value !== 'string')
  ) {
    violations.push('meta.json: messages はstring値のobjectが必要です。');
  }
  return violations;
}

function expectedPaths(directory) {
  return [...SCAFFOLD_FILES, ...GENERATED_FILES]
    .map((file) => `packages/rules/${directory}/${file}`)
    .sort();
}

export function validateRulePullRequest(options) {
  const {
    base,
    head,
    branch,
    prBody,
    author,
    allowedAuthors,
    cwd = process.cwd(),
  } = options;
  const entries = changedEntries({ base, head, cwd });
  const violations = [];
  if (entries.length === 0) {
    return {
      entries,
      directory: null,
      scaffoldSha: null,
      violations: ['差分がありません。'],
    };
  }

  const matches = entries.map((entry) => ({
    ...entry,
    match: RULE_PATH.exec(entry.path),
  }));
  for (const entry of matches) {
    if (!entry.match) {
      violations.push(
        `${entry.path}: 許可されたルールファイルではありません。`,
      );
    }
    if (entry.status !== 'A') {
      violations.push(
        `${entry.path}: 新規ルールPRでは追加(A)だけ許可します(status=${entry.status})。`,
      );
    }
  }
  const directories = [
    ...new Set(
      matches.flatMap((entry) => (entry.match ? [entry.match[1]] : [])),
    ),
  ];
  if (directories.length !== 1) {
    violations.push('変更対象のルールdirectoryは1つだけ必要です。');
  }
  const directory = directories.length === 1 ? directories[0] : null;
  if (directory) {
    const actualPaths = matches
      .flatMap((entry) => (entry.match ? [entry.path] : []))
      .sort();
    const expected = expectedPaths(directory);
    if (JSON.stringify(actualPaths) !== JSON.stringify(expected)) {
      violations.push(
        `許可ファイル4件が揃っていません: ${expected.join(', ')}`,
      );
    }
    if (branch !== `rule/${directory}` && branch !== `rule/${directory}-a2`) {
      violations.push(
        `branch ${branch} が rule/${directory} または rule/${directory}-a2 と一致しません。`,
      );
    }
  }

  const normalizedAllowedAuthors = new Set(
    allowedAuthors.map((value) => value.trim().toLowerCase()).filter(Boolean),
  );
  if (
    normalizedAllowedAuthors.size === 0 ||
    !normalizedAllowedAuthors.has(author.trim().toLowerCase())
  ) {
    violations.push(
      `PR作成者 ${author} は許可されたpipeline作成者ではありません。`,
    );
  }

  const scaffoldSha = scaffoldShaFromBody(prBody);
  if (!scaffoldSha) {
    violations.push('PR本文の機械可読blockにscaffold-shaが1件必要です。');
  }
  if (!directory || !scaffoldSha) {
    return { entries, directory, scaffoldSha, violations };
  }

  if (
    gitExitCode(cwd, ['merge-base', '--is-ancestor', scaffoldSha, head]) !== 0
  ) {
    violations.push('scaffold SHAはPR headの祖先ではありません。');
    return { entries, directory, scaffoldSha, violations };
  }
  const mergeBase = git(cwd, ['merge-base', base, head]).trim();
  const scaffoldParent = git(cwd, ['rev-parse', `${scaffoldSha}^`]).trim();
  if (scaffoldParent !== mergeBase) {
    violations.push('scaffold commitはPR branchの基点直後ではありません。');
  }

  const scaffoldPaths = git(cwd, [
    'diff-tree',
    '--no-commit-id',
    '--name-only',
    '-r',
    scaffoldSha,
  ])
    .split('\n')
    .filter(Boolean)
    .sort();
  const expectedScaffoldPaths = SCAFFOLD_FILES.map(
    (file) => `packages/rules/${directory}/${file}`,
  ).sort();
  if (JSON.stringify(scaffoldPaths) !== JSON.stringify(expectedScaffoldPaths)) {
    violations.push(
      'scaffold commitはmeta.jsonとSPEC.jsonだけを含む必要があります。',
    );
  }
  if (
    gitExitCode(cwd, [
      'diff',
      '--quiet',
      scaffoldSha,
      head,
      '--',
      ...expectedScaffoldPaths,
    ]) !== 0
  ) {
    violations.push(
      'meta.jsonまたはSPEC.jsonがscaffold commit後に変わっています。',
    );
  }

  try {
    const meta = JSON.parse(
      git(cwd, [
        'show',
        `${scaffoldSha}:packages/rules/${directory}/meta.json`,
      ]),
    );
    violations.push(...validateMeta(meta, directory));
  } catch {
    violations.push('meta.jsonをscaffold commitから読み取り・解析できません。');
  }
  return { entries, directory, scaffoldSha, violations };
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function main() {
  const base = argumentValue('--base') ?? process.env.RULE_DIFF_BASE;
  const head = argumentValue('--head') ?? process.env.RULE_DIFF_HEAD;
  const branch = argumentValue('--branch') ?? process.env.RULE_PR_BRANCH;
  const prBody = process.env.RULE_PR_BODY ?? '';
  const author = process.env.RULE_PR_AUTHOR ?? '';
  const allowedAuthors = (process.env.RULE_PR_ALLOWED_AUTHORS ?? '')
    .split(',')
    .map((value) => value.trim());

  if (!base || !head || !branch) {
    console.error(
      '使い方: node scripts/diff-guard.mjs --base <base-ref> --head <head-ref> --branch <branch>',
    );
    process.exitCode = 2;
    return;
  }
  const result = validateRulePullRequest({
    base,
    head,
    branch,
    prBody,
    author,
    allowedAuthors,
  });
  console.log('検査対象の変更:');
  for (const entry of result.entries) {
    console.log(`- ${entry.status} ${entry.path}`);
  }
  if (result.violations.length > 0) {
    console.error('ルールPRの差分ガードに違反しています:');
    for (const violation of result.violations) console.error(`- ${violation}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `差分ガード通過: ${result.directory}, scaffold ${result.scaffoldSha}`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
