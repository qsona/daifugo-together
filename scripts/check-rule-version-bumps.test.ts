import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { validateRuleVersionBumps } from './check-rule-version-bumps.mjs';

const repositories: string[] = [];
const ruleId = 'r0007-spade-3-gaeshi';

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function write(cwd: string, path: string, contents: string) {
  const absolute = join(cwd, path);
  mkdirSync(join(absolute, '..'), { recursive: true });
  writeFileSync(absolute, contents);
}

function commit(cwd: string, message: string) {
  git(cwd, 'add', '--all');
  git(cwd, 'commit', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
}

function repository() {
  const cwd = mkdtempSync(join(tmpdir(), 'rule-version-bump-'));
  repositories.push(cwd);
  git(cwd, 'init', '--quiet');
  git(cwd, 'config', 'user.email', 'test@example.com');
  git(cwd, 'config', 'user.name', 'Test User');
  write(cwd, `packages/rules/${ruleId}/rule.ts`, 'export const value = 1;\n');
  write(cwd, 'packages/rules/rule-versions.json', '{}\n');
  return { cwd, base: commit(cwd, 'initial') };
}

afterEach(() => {
  for (const cwd of repositories.splice(0)) {
    rmSync(cwd, { recursive: true, force: true });
  }
});

describe('rule version bump check', () => {
  it('既存rule.tsの変更だけでは失敗する', () => {
    const fixture = repository();
    write(
      fixture.cwd,
      `packages/rules/${ruleId}/rule.ts`,
      'export const value = 2;\n',
    );
    const head = commit(fixture.cwd, 'change rule');

    expect(validateRuleVersionBumps({ ...fixture, head })).toEqual([
      {
        ruleId,
        path: `packages/rules/${ruleId}/rule.ts`,
        baseVersion: 1,
        headVersion: 1,
      },
    ]);
  });

  it('rule.ts変更時に版を繰り上げれば通す', () => {
    const fixture = repository();
    write(
      fixture.cwd,
      `packages/rules/${ruleId}/rule.ts`,
      'export const value = 2;\n',
    );
    write(
      fixture.cwd,
      'packages/rules/rule-versions.json',
      `${JSON.stringify({ [ruleId]: 2 }, null, 2)}\n`,
    );
    const head = commit(fixture.cwd, 'change and bump rule');

    expect(validateRuleVersionBumps({ ...fixture, head })).toEqual([]);
  });

  it('新規ルールのv1追加とルール外の変更は対象にしない', () => {
    const fixture = repository();
    write(
      fixture.cwd,
      'packages/rules/r0008-new-rule/rule.ts',
      'export const value = 1;\n',
    );
    write(fixture.cwd, 'README.md', '# changed\n');
    const head = commit(fixture.cwd, 'add rule');

    expect(validateRuleVersionBumps({ ...fixture, head })).toEqual([]);
  });
});
