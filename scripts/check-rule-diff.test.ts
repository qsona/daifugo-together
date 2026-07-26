import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { checkRuleDiff } from './check-rule-diff.mjs';

const repositories: string[] = [];

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

function createRepository() {
  const cwd = mkdtempSync(join(tmpdir(), 'rule-diff-'));
  repositories.push(cwd);
  git(cwd, 'init', '--quiet');
  git(cwd, 'config', 'user.email', 'test@example.com');
  git(cwd, 'config', 'user.name', 'Test User');
  write(cwd, 'README.md', '# test\n');
  const base = commit(cwd, 'initial');
  return { cwd, base };
}

afterEach(() => {
  for (const repository of repositories.splice(0)) {
    rmSync(repository, { recursive: true, force: true });
  }
});

describe('checkRuleDiff', () => {
  it('packages/rules/ 配下だけの変更を許可する', () => {
    const { cwd, base } = createRepository();
    write(cwd, 'packages/rules/r0001-yagiri/rule.ts', 'export {};\n');
    const head = commit(cwd, 'add rule');

    expect(checkRuleDiff({ cwd, base, head })).toEqual({
      paths: ['packages/rules/r0001-yagiri/rule.ts'],
      violations: [],
    });
  });

  it('packages/rules/ 配下以外の変更を拒否する', () => {
    const { cwd, base } = createRepository();
    write(cwd, 'packages/rules/r0001-yagiri/rule.ts', 'export {};\n');
    write(cwd, 'packages/core/src/index.ts', 'export {};\n');
    const head = commit(cwd, 'change rule and core');

    const result = checkRuleDiff({ cwd, base, head });
    expect(result.paths).toEqual([
      'packages/core/src/index.ts',
      'packages/rules/r0001-yagiri/rule.ts',
    ]);
    expect(result.violations).toEqual([
      'packages/core/src/index.ts: packages/rules/ 配下ではありません。',
    ]);
  });

  it('rules 外から rules 内への rename でも元のパスを検査する', () => {
    const { cwd } = createRepository();
    write(cwd, 'outside.ts', 'export const value = 1;\n');
    const base = commit(cwd, 'add outside file');
    mkdirSync(join(cwd, 'packages/rules/r0001-yagiri'), { recursive: true });
    renameSync(
      join(cwd, 'outside.ts'),
      join(cwd, 'packages/rules/r0001-yagiri/rule.ts'),
    );
    const head = commit(cwd, 'move file into rules');

    const result = checkRuleDiff({ cwd, base, head });
    expect(result.paths).toContain('outside.ts');
    expect(result.violations).toEqual([
      'outside.ts: packages/rules/ 配下ではありません。',
    ]);
  });

  it('差分がない比較を拒否する', () => {
    const { cwd, base } = createRepository();

    expect(checkRuleDiff({ cwd, base, head: base }).violations).toEqual([
      '差分がありません。',
    ]);
  });
});
