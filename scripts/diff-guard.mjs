import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const RULE_PATH =
  /^packages\/rules\/(r\d{4,}-[a-z0-9]+(?:-[a-z0-9]+)*)\/(rule\.ts|rule\.test\.ts|meta\.json|SPEC\.json)$/;
const GENERATED_RULE_PATH =
  /^packages\/rules\/(r\d{4,}-[a-z0-9]+(?:-[a-z0-9]+)*)\/(.+)$/;
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

function validateRevertExclude(cwd, base, head, directory) {
  try {
    const before = JSON.parse(
      git(cwd, ['show', `${base}:packages/rules/rules-exclude.json`]),
    );
    const after = JSON.parse(
      git(cwd, ['show', `${head}:packages/rules/rules-exclude.json`]),
    );
    if (
      !Array.isArray(before) ||
      !Array.isArray(after) ||
      !before.every((value) => typeof value === 'string') ||
      !after.every((value) => typeof value === 'string') ||
      new Set(before).size !== before.length ||
      new Set(after).size !== after.length
    ) {
      return ['rules-exclude.jsonは重複のないstring配列である必要があります。'];
    }
    const expected = before.filter((ruleId) => ruleId !== directory);
    if (
      !before.includes(directory) ||
      JSON.stringify(after) !== JSON.stringify(expected)
    ) {
      return [
        `rules-exclude.jsonはrevert対象 ${directory} の既存entry削除だけ許可します。`,
      ];
    }
    return [];
  } catch {
    return ['rules-exclude.jsonのrevert差分を解析できません。'];
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

export function pipelineMetadataFromBody(body) {
  const blocks = [
    ...body.matchAll(
      /<!-- daifugo-pipeline\s+([\s\S]*?)\s+end-daifugo-pipeline -->/g,
    ),
  ];
  if (blocks.length !== 1) return null;
  const scaffoldMatches = [
    ...blocks[0][1].matchAll(
      /(?:^|\n)scaffold-sha:\s*([0-9a-f]{40,64})\s*(?=\n|$)/g,
    ),
  ];
  const baseMatches = [
    ...blocks[0][1].matchAll(
      /(?:^|\n)base-sha:\s*([0-9a-f]{40,64})\s*(?=\n|$)/g,
    ),
  ];
  return scaffoldMatches.length === 1 && baseMatches.length === 1
    ? {
        scaffoldSha: scaffoldMatches[0][1],
        baseSha: baseMatches[0][1],
      }
    : null;
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
  const allowedKeys = new Set([
    ...requiredStrings,
    'kind',
    'prefecture',
    'contractVersion',
    'messages',
    'engineFeatures',
  ]);
  for (const key of Object.keys(meta)) {
    if (!allowedKeys.has(key)) {
      violations.push(`meta.json: 未知のproperty ${key} は許可されません。`);
    }
  }
  if (meta.engineFeatures !== undefined) {
    const knownFeatures = new Set(['sequence', 'jokers']);
    if (
      !Array.isArray(meta.engineFeatures) ||
      meta.engineFeatures.some((value) => !knownFeatures.has(value)) ||
      new Set(meta.engineFeatures).size !== meta.engineFeatures.length
    ) {
      violations.push(
        'meta.json: engineFeatures は sequence / jokers の重複なし配列が必要です。',
      );
    }
  }
  if (typeof meta.name === 'string' && meta.name.length > 40) {
    violations.push('meta.json: name は40文字以下が必要です。');
  }
  if (typeof meta.description === 'string' && meta.description.length > 1_000) {
    violations.push('meta.json: description は1000文字以下が必要です。');
  }
  if (meta.ruleId !== directory) {
    violations.push(
      `meta.json: ruleId ${String(meta.ruleId)} がdirectory ${directory} と一致しません。`,
    );
  }
  if (meta.kind !== 'local' && meta.kind !== 'original') {
    violations.push('meta.json: kind は local または original が必要です。');
  }
  if (meta.contractVersion !== 1 && meta.contractVersion !== 2) {
    violations.push('meta.json: contractVersion は 1 または 2 が必要です。');
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
  } else {
    const entries = Object.entries(meta.messages);
    if (
      entries.length > 20 ||
      entries.some(
        ([key, value]) =>
          !/^[a-z][a-z0-9_]{0,63}$/u.test(key) ||
          value.trim().length === 0 ||
          value.length > 200,
      )
    ) {
      violations.push(
        'meta.json: messages は20件以下、key形式と1〜200文字の値が必要です。',
      );
    }
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
      mode: 'ordinary',
      directory: null,
      scaffoldSha: null,
      recordedBaseSha: null,
      violations: ['差分がありません。'],
    };
  }

  const mode = branch.startsWith('rule/')
    ? 'pipeline'
    : branch.startsWith('revert/')
      ? 'revert'
      : 'ordinary';
  const normalizedAllowedAuthors = new Set(
    allowedAuthors.map((value) => value.trim().toLowerCase()).filter(Boolean),
  );
  const authorAllowed =
    normalizedAllowedAuthors.size > 0 &&
    normalizedAllowedAuthors.has(author.trim().toLowerCase());
  if (mode === 'ordinary') {
    for (const entry of entries) {
      if (GENERATED_RULE_PATH.test(entry.path)) {
        violations.push(
          `${entry.path}: generated ruleの変更はrule/**またはrevert/** branchだけ許可します。`,
        );
      }
    }
    return {
      entries,
      mode,
      directory: null,
      scaffoldSha: null,
      recordedBaseSha: null,
      violations,
    };
  }

  if (!authorAllowed) {
    violations.push(
      `PR作成者 ${author} は許可されたpipeline作成者ではありません。`,
    );
  }
  if (mode === 'revert') {
    const revertDirectories = new Set();
    for (const entry of entries) {
      const match = RULE_PATH.exec(entry.path);
      if (match) {
        revertDirectories.add(match[1]);
        if (entry.status !== 'D') {
          violations.push(
            `${entry.path}: revert PRでは削除(D)だけ許可します(status=${entry.status})。`,
          );
        }
      } else if (
        entry.path !== 'packages/rules/rules-exclude.json' ||
        entry.status !== 'M'
      ) {
        violations.push(
          `${entry.path}: revert PRで許可された差分ではありません。`,
        );
      }
    }
    const directories = [...revertDirectories];
    if (directories.length !== 1) {
      violations.push('revert対象のルールdirectoryは1つだけ必要です。');
    }
    const directory = directories.length === 1 ? directories[0] : null;
    if (directory) {
      const deleted = entries
        .filter((entry) => RULE_PATH.test(entry.path))
        .map((entry) => entry.path)
        .sort();
      if (
        JSON.stringify(deleted) !== JSON.stringify(expectedPaths(directory))
      ) {
        violations.push('revert PRは対象ルールの4ファイルを削除してください。');
      }
      if (branch !== `revert/${directory}`) {
        violations.push(
          `branch ${branch} が revert/${directory} と一致しません。`,
        );
      }
      if (
        entries.some(
          (entry) => entry.path === 'packages/rules/rules-exclude.json',
        )
      ) {
        violations.push(...validateRevertExclude(cwd, base, head, directory));
      }
    }
    return {
      entries,
      mode,
      directory,
      scaffoldSha: null,
      recordedBaseSha: null,
      violations,
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
    const branchPattern = new RegExp(
      `^rule/${directory}(?:-a(?:[2-9]|[1-9][0-9]+))?$`,
      'u',
    );
    if (!branchPattern.test(branch)) {
      violations.push(
        `branch ${branch} が rule/${directory} または rule/${directory}-aN (N >= 2) と一致しません。`,
      );
    }
  }

  const metadata = pipelineMetadataFromBody(prBody);
  const scaffoldSha = metadata?.scaffoldSha ?? null;
  const recordedBaseSha = metadata?.baseSha ?? null;
  if (!metadata) {
    violations.push(
      'PR本文の機械可読blockにscaffold-shaとbase-shaが各1件必要です。',
    );
  }
  if (!directory || !scaffoldSha || !recordedBaseSha) {
    return {
      entries,
      mode,
      directory,
      scaffoldSha,
      recordedBaseSha,
      violations,
    };
  }

  if (
    gitExitCode(cwd, ['merge-base', '--is-ancestor', scaffoldSha, head]) !== 0
  ) {
    violations.push('scaffold SHAはPR headの祖先ではありません。');
    return {
      entries,
      mode,
      directory,
      scaffoldSha,
      recordedBaseSha,
      violations,
    };
  }
  for (const path of expectedPaths(directory)) {
    const treeEntry = git(cwd, ['ls-tree', head, '--', path]).trim();
    if (!treeEntry.startsWith('100644 blob ')) {
      violations.push(`${path}: regular file mode 100644が必要です。`);
    }
  }
  let scaffoldParent = null;
  try {
    scaffoldParent = git(cwd, ['rev-parse', `${scaffoldSha}^`]).trim();
  } catch {
    violations.push('scaffold commitの親を検証できません。');
  }
  if (scaffoldParent !== null && scaffoldParent !== recordedBaseSha) {
    violations.push('scaffold commitの親が記録済みbase SHAと一致しません。');
  }
  if (
    gitExitCode(cwd, ['merge-base', '--is-ancestor', recordedBaseSha, base]) !==
    0
  ) {
    violations.push('記録済みbase SHAは現在のmainの祖先ではありません。');
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
  return {
    entries,
    mode,
    directory,
    scaffoldSha,
    recordedBaseSha,
    violations,
  };
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
    `差分ガード通過: mode=${result.mode}, directory=${result.directory ?? '-'}, scaffold=${result.scaffoldSha ?? '-'}`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
