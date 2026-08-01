import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const hookSource = fileURLToPath(
  new URL('../.githooks/pre-push', import.meta.url),
);
const temporaryRoots: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function setupRepository() {
  const root = mkdtempSync(join(tmpdir(), 'daifugo-main-push-guard-'));
  temporaryRoots.push(root);
  const remote = join(root, 'remote.git');
  const repo = join(root, 'repo');

  mkdirSync(repo);
  git(root, 'init', '--bare', remote);
  git(repo, 'init', '--initial-branch=main');
  git(repo, 'config', 'user.name', 'Main Push Guard Test');
  git(repo, 'config', 'user.email', 'main-push-guard@example.invalid');
  writeFileSync(join(repo, 'state.txt'), 'main\n');
  git(repo, 'add', 'state.txt');
  git(repo, 'commit', '-m', 'initial main');
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', 'origin', 'main');

  const hooks = join(repo, '.githooks');
  mkdirSync(hooks);
  const hook = join(hooks, 'pre-push');
  copyFileSync(hookSource, hook);
  chmodSync(hook, 0o755);
  git(repo, 'config', 'core.hooksPath', '.githooks');

  git(repo, 'switch', '-c', 'feature');
  writeFileSync(join(repo, 'state.txt'), 'feature\n');
  git(repo, 'add', 'state.txt');
  git(repo, 'commit', '-m', 'feature change');

  return {
    repo,
    remote,
    featureOid: git(repo, 'rev-parse', 'feature'),
    remoteMainOid: git(remote, 'rev-parse', 'refs/heads/main'),
  };
}

function push(repo: string, ...args: string[]) {
  return spawnSync('git', ['push', ...args], {
    cwd: repo,
    encoding: 'utf8',
  });
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('main push guard', () => {
  it('HEAD:mainを拒否する', () => {
    const { repo, remote, remoteMainOid } = setupRepository();

    const result = push(repo, 'origin', 'HEAD:main');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('push元がローカル main ではありません');
    expect(git(remote, 'rev-parse', 'refs/heads/main')).toBe(remoteMainOid);
  });

  it('作業ブランチ:mainを拒否する', () => {
    const { repo, remote, remoteMainOid } = setupRepository();

    const result = push(repo, 'origin', 'feature:main');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('push元がローカル main ではありません');
    expect(git(remote, 'rev-parse', 'refs/heads/main')).toBe(remoteMainOid);
  });

  it('作業ブランチのworktreeからローカルmainをpushする操作も拒否する', () => {
    const { repo, remote, remoteMainOid } = setupRepository();
    git(repo, 'branch', '--force', 'main', 'feature');

    const result = push(repo, 'origin', 'main');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('現在のworktreeが main ではありません');
    expect(git(remote, 'rev-parse', 'refs/heads/main')).toBe(remoteMainOid);
  });

  it('mainのworktreeからのfast-forward pushを許可する', () => {
    const { repo, remote, featureOid } = setupRepository();
    git(repo, 'switch', 'main');
    git(repo, 'merge', '--ff-only', 'feature');

    const result = push(repo, 'origin', 'main');

    expect(result.status).toBe(0);
    expect(git(remote, 'rev-parse', 'refs/heads/main')).toBe(featureOid);
  });
});
