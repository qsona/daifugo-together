import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { validateRulePullRequest } from './diff-guard.mjs';

const repositories: string[] = [];
const directory = 'r0001-yagiri';
const redTeamCases = JSON.parse(
  readFileSync(
    join(process.cwd(), 'fixtures/red-team/diff-guard/cases.json'),
    'utf8',
  ),
) as Array<{ name: string; path: string; contents: string }>;

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function write(cwd: string, path: string, contents: string) {
  const absolutePath = join(cwd, path);
  mkdirSync(join(absolutePath, '..'), { recursive: true });
  writeFileSync(absolutePath, contents);
}

function commit(cwd: string, message: string) {
  git(cwd, 'add', '--all');
  git(cwd, 'commit', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
}

function meta(ruleId = directory) {
  return `${JSON.stringify(
    {
      ruleId,
      name: '八切り',
      description: '8で場を流す',
      kind: 'local',
      prefecture: '埼玉県',
      proposalId: 'proposal-1',
      contractVersion: 1,
      messages: {},
    },
    null,
    2,
  )}\n`;
}

function createRepository(metaContent = meta()) {
  const cwd = mkdtempSync(join(tmpdir(), 'rule-diff-'));
  repositories.push(cwd);
  git(cwd, 'init', '--quiet');
  git(cwd, 'config', 'user.email', 'test@example.com');
  git(cwd, 'config', 'user.name', 'Test User');
  write(cwd, 'README.md', '# test\n');
  const base = commit(cwd, 'initial');
  write(cwd, `packages/rules/${directory}/meta.json`, metaContent);
  write(cwd, `packages/rules/${directory}/SPEC.json`, '{"specVersion":1}\n');
  const scaffoldSha = commit(cwd, 'scaffold');
  write(cwd, `packages/rules/${directory}/rule.ts`, 'export {};\n');
  write(
    cwd,
    `packages/rules/${directory}/rule.test.ts`,
    'export const cases = [1, 2, 3];\n',
  );
  const head = commit(cwd, 'implement');
  return { cwd, base, scaffoldSha, head };
}

function check(
  repository: ReturnType<typeof createRepository>,
  overrides: Partial<Parameters<typeof validateRulePullRequest>[0]> = {},
) {
  return validateRulePullRequest({
    ...repository,
    branch: `rule/${directory}`,
    prBody: `<!-- daifugo-pipeline\nscaffold-sha: ${repository.scaffoldSha}\nbase-sha: ${repository.base}\nend-daifugo-pipeline -->`,
    author: 'qsona',
    allowedAuthors: ['qsona'],
    ...overrides,
  });
}

afterEach(() => {
  for (const repository of repositories.splice(0)) {
    rmSync(repository, { recursive: true, force: true });
  }
});

describe('diff guard', () => {
  it('固定scaffoldから生成された単一ルールPRを許可する', () => {
    const repository = createRepository();

    expect(check(repository)).toMatchObject({
      mode: 'pipeline',
      directory,
      scaffoldSha: repository.scaffoldSha,
      recordedBaseSha: repository.base,
      violations: [],
    });
  });

  it('範囲外変更と許可外ファイルを拒否する', () => {
    const repository = createRepository();
    write(repository.cwd, 'packages/core/src/index.ts', 'export {};\n');
    write(
      repository.cwd,
      `packages/rules/${directory}/notes.md`,
      'untrusted\n',
    );
    repository.head = commit(repository.cwd, 'unexpected paths');

    expect(check(repository).violations).toEqual(
      expect.arrayContaining([
        'packages/core/src/index.ts: 許可されたルールファイルではありません。',
        `packages/rules/${directory}/notes.md: 許可されたルールファイルではありません。`,
      ]),
    );
  });

  it.each(redTeamCases)('$name fixtureをdiff guardが拒否する', (fixture) => {
    const repository = createRepository();
    write(repository.cwd, fixture.path, fixture.contents);
    repository.head = commit(repository.cwd, `red team: ${fixture.name}`);

    expect(check(repository).violations).not.toHaveLength(0);
  });

  it('meta.jsonの既知engineFeaturesを許可する', () => {
    const metaContent = `${JSON.stringify(
      {
        ruleId: directory,
        name: '階段',
        description: '同スート連番3枚以上',
        kind: 'local',
        proposalId: 'proposal-1',
        contractVersion: 1,
        messages: {},
        engineFeatures: ['sequence', 'jokers'],
      },
      null,
      2,
    )}\n`;
    const repository = createRepository(metaContent);
    expect(check(repository)).toMatchObject({
      mode: 'pipeline',
      directory,
      violations: [],
    });
  });

  it('meta.jsonの未知engineFeaturesを拒否する', () => {
    const metaContent = `${JSON.stringify(
      {
        ruleId: directory,
        name: '階段',
        description: '同スート連番3枚以上',
        kind: 'local',
        proposalId: 'proposal-1',
        contractVersion: 1,
        messages: {},
        engineFeatures: ['staircase'],
      },
      null,
      2,
    )}\n`;
    const repository = createRepository(metaContent);
    const result = check(repository);
    expect(result.violations.join('\n')).toContain('engineFeatures');
  });

  it('複数ルールdirectoryを拒否する', () => {
    const repository = createRepository();
    write(
      repository.cwd,
      'packages/rules/r0002-revolution/rule.ts',
      'export {};\n',
    );
    repository.head = commit(repository.cwd, 'second rule');

    expect(check(repository).violations).toContain(
      '変更対象のルールdirectoryは1つだけ必要です。',
    );
  });

  it('既存ファイル変更・削除を新規ルールPRとして拒否する', () => {
    const repository = createRepository();
    repository.base = repository.head;
    write(
      repository.cwd,
      `packages/rules/${directory}/rule.ts`,
      'export const changed = true;\n',
    );
    repository.head = commit(repository.cwd, 'modify generated file');

    expect(check(repository).violations).toContain(
      `packages/rules/${directory}/rule.ts: 新規ルールPRでは追加(A)だけ許可します(status=M)。`,
    );
  });

  it('branch名とdirectoryの不一致を拒否する', () => {
    const repository = createRepository();

    expect(
      check(repository, { branch: 'rule/r9999-other' }).violations,
    ).toContain(
      `branch rule/r9999-other が rule/${directory} または rule/${directory}-aN (N >= 2) と一致しません。`,
    );
  });

  it('-a2以降のrevision branchを許可する', () => {
    const repository = createRepository();

    expect(
      check(repository, { branch: `rule/${directory}-a2` }).violations,
    ).toEqual([]);
    expect(
      check(repository, { branch: `rule/${directory}-a3` }).violations,
    ).toEqual([]);
    expect(
      check(repository, { branch: `rule/${directory}-a10` }).violations,
    ).toEqual([]);
    expect(
      check(repository, { branch: `rule/${directory}-a1` }).violations,
    ).toContain(
      `branch rule/${directory}-a1 が rule/${directory} または rule/${directory}-aN (N >= 2) と一致しません。`,
    );
  });

  it('第三者PRを拒否する', () => {
    const repository = createRepository();

    expect(check(repository, { author: 'attacker' }).violations).toContain(
      'PR作成者 attacker は許可されたpipeline作成者ではありません。',
    );
    expect(check(repository, { allowedAuthors: [] }).violations).toContain(
      'PR作成者 qsona は許可されたpipeline作成者ではありません。',
    );
  });

  it('機械可読blockの欠落・重複・不正SHAを拒否する', () => {
    const repository = createRepository();
    const duplicate = `<!-- daifugo-pipeline
scaffold-sha: ${repository.scaffoldSha}
scaffold-sha: ${repository.scaffoldSha}
base-sha: ${repository.base}
end-daifugo-pipeline -->`;

    expect(check(repository, { prBody: '' }).violations).toContain(
      'PR本文の機械可読blockにscaffold-shaとbase-shaが各1件必要です。',
    );
    expect(check(repository, { prBody: duplicate }).violations).toContain(
      'PR本文の機械可読blockにscaffold-shaとbase-shaが各1件必要です。',
    );
    expect(
      check(repository, {
        prBody: `<!-- daifugo-pipeline
scaffold-sha: ${repository.scaffoldSha}
base-sha: ${repository.base}
end-daifugo-pipeline -->
<!-- daifugo-pipeline
scaffold-sha: ${repository.scaffoldSha}
base-sha: ${repository.base}
end-daifugo-pipeline -->`,
      }).violations,
    ).toContain(
      'PR本文の機械可読blockにscaffold-shaとbase-shaが各1件必要です。',
    );
    expect(
      check(repository, {
        prBody: `<!-- daifugo-pipeline
scaffold-sha: ${'f'.repeat(40)}
base-sha: ${repository.base}
end-daifugo-pipeline -->`,
      }).violations,
    ).toContain('scaffold SHAはPR headの祖先ではありません。');
  });

  it('scaffold後のmeta/SPEC改変を拒否する', () => {
    const repository = createRepository();
    write(
      repository.cwd,
      `packages/rules/${directory}/SPEC.json`,
      '{"specVersion":2}\n',
    );
    repository.head = commit(repository.cwd, 'tamper spec');

    expect(check(repository).violations).toContain(
      'meta.jsonまたはSPEC.jsonがscaffold commit後に変わっています。',
    );
  });

  it('scaffold commitの余分な差分とmeta schema不一致を拒否する', () => {
    const repository = createRepository();
    git(repository.cwd, 'reset', '--hard', repository.base);
    write(
      repository.cwd,
      `packages/rules/${directory}/meta.json`,
      meta('r9999-other'),
    );
    write(
      repository.cwd,
      `packages/rules/${directory}/SPEC.json`,
      '{"specVersion":1}\n',
    );
    write(repository.cwd, 'unexpected.txt', 'unexpected\n');
    repository.scaffoldSha = commit(repository.cwd, 'bad scaffold');
    write(
      repository.cwd,
      `packages/rules/${directory}/rule.ts`,
      'export {};\n',
    );
    write(
      repository.cwd,
      `packages/rules/${directory}/rule.test.ts`,
      'export const cases = [1, 2, 3];\n',
    );
    repository.head = commit(repository.cwd, 'implement');

    expect(check(repository).violations).toEqual(
      expect.arrayContaining([
        'scaffold commitはmeta.jsonとSPEC.jsonだけを含む必要があります。',
        `meta.json: ruleId r9999-other がdirectory ${directory} と一致しません。`,
      ]),
    );
  });

  it('scaffoldがbranch基点直後でない履歴を拒否する', () => {
    const repository = createRepository();
    git(repository.cwd, 'reset', '--hard', repository.base);
    write(repository.cwd, 'intermediate.txt', 'not scaffold\n');
    commit(repository.cwd, 'intermediate');
    write(repository.cwd, `packages/rules/${directory}/meta.json`, meta());
    write(
      repository.cwd,
      `packages/rules/${directory}/SPEC.json`,
      '{"specVersion":1}\n',
    );
    repository.scaffoldSha = commit(repository.cwd, 'scaffold');
    write(
      repository.cwd,
      `packages/rules/${directory}/rule.ts`,
      'export {};\n',
    );
    write(
      repository.cwd,
      `packages/rules/${directory}/rule.test.ts`,
      'export const cases = [1, 2, 3];\n',
    );
    repository.head = commit(repository.cwd, 'implement');

    expect(
      check(repository, {
        prBody: `<!-- daifugo-pipeline
scaffold-sha: ${repository.scaffoldSha}
base-sha: ${repository.base}
end-daifugo-pipeline -->`,
      }).violations,
    ).toContain('scaffold commitの親が記録済みbase SHAと一致しません。');
  });

  it('通常branchはgenerated rule差分を拒否し、非生成差分だけなら許可する', () => {
    const repository = createRepository();
    expect(check(repository, { branch: 'feature/bypass' }).violations).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'generated ruleの変更はrule/**またはrevert/** branchだけ許可します。',
        ),
      ]),
    );

    git(repository.cwd, 'reset', '--hard', repository.base);
    write(repository.cwd, 'docs/note.md', 'normal change\n');
    repository.head = commit(repository.cwd, 'normal change');
    expect(check(repository, { branch: 'feature/normal' })).toMatchObject({
      mode: 'ordinary',
      violations: [],
    });
  });

  it('trusted revert branchだけが単一ルール4ファイルの削除を許可する', () => {
    const repository = createRepository();
    repository.base = repository.head;
    for (const file of ['meta.json', 'SPEC.json', 'rule.ts', 'rule.test.ts']) {
      git(repository.cwd, 'rm', `packages/rules/${directory}/${file}`);
    }
    repository.head = commit(repository.cwd, 'revert rule');

    expect(check(repository, { branch: `revert/${directory}` })).toMatchObject({
      mode: 'revert',
      directory,
      violations: [],
    });
    expect(
      check(repository, {
        branch: `revert/${directory}`,
        author: 'attacker',
      }).violations,
    ).toContain('PR作成者 attacker は許可されたpipeline作成者ではありません。');
  });

  it('revert時のrules-exclude変更は対象entryの削除だけを許可する', () => {
    const repository = createRepository();
    write(
      repository.cwd,
      'packages/rules/rules-exclude.json',
      `${JSON.stringify([directory, 'r0002-other'])}\n`,
    );
    repository.base = commit(repository.cwd, 'temporarily exclude rule');
    for (const file of ['meta.json', 'SPEC.json', 'rule.ts', 'rule.test.ts']) {
      git(repository.cwd, 'rm', `packages/rules/${directory}/${file}`);
    }
    write(
      repository.cwd,
      'packages/rules/rules-exclude.json',
      `${JSON.stringify(['r0002-other'])}\n`,
    );
    repository.head = commit(repository.cwd, 'revert and remove exclusion');

    expect(
      check(repository, { branch: `revert/${directory}` }).violations,
    ).toEqual([]);

    git(repository.cwd, 'reset', '--hard', repository.base);
    for (const file of ['meta.json', 'SPEC.json', 'rule.ts', 'rule.test.ts']) {
      git(repository.cwd, 'rm', `packages/rules/${directory}/${file}`);
    }
    write(
      repository.cwd,
      'packages/rules/rules-exclude.json',
      `${JSON.stringify(['r9999-injected'])}\n`,
    );
    repository.head = commit(repository.cwd, 'tamper exclusion during revert');
    expect(
      check(repository, { branch: `revert/${directory}` }).violations,
    ).toContain(
      `rules-exclude.jsonはrevert対象 ${directory} の既存entry削除だけ許可します。`,
    );
  });

  it('main更新をmergeしても記録済みbaseとscaffoldを維持して通過する', () => {
    const repository = createRepository();
    const ruleHead = repository.head;
    git(repository.cwd, 'checkout', '-b', 'updated-main', repository.base);
    write(repository.cwd, 'docs/main.md', 'main advanced\n');
    const currentBase = commit(repository.cwd, 'advance main');
    git(repository.cwd, 'checkout', '-b', 'rule-branch', ruleHead);
    git(repository.cwd, 'merge', '--no-edit', 'updated-main');
    repository.head = git(repository.cwd, 'rev-parse', 'HEAD');

    expect(
      git(
        repository.cwd,
        'merge-base',
        '--is-ancestor',
        currentBase,
        repository.head,
      ),
    ).toBe('');
    expect(check(repository, { base: currentBase }).violations).toEqual([]);
  });

  it('generated ruleのsymlinkをregular fileとして拒否する', () => {
    const repository = createRepository();
    const rulePath = join(
      repository.cwd,
      `packages/rules/${directory}/rule.ts`,
    );
    unlinkSync(rulePath);
    symlinkSync('SPEC.json', rulePath);
    repository.head = commit(repository.cwd, 'replace rule with symlink');

    expect(check(repository).violations).toContain(
      `packages/rules/${directory}/rule.ts: regular file mode 100644が必要です。`,
    );
  });
});
