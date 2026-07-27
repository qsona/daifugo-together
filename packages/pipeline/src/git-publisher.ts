import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { relative, sep } from 'node:path';

import type { QueuedImplementation } from '@daifugo/server';

import type { ScaffoldPublisher } from './implementation-driver.js';
import { inspectGeneratedRule } from './inspector.js';
import { SpawnProcessPort, type ProcessPort } from './process.js';
import type { ScaffoldResult } from './scaffold.js';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function lines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function statusLines(value: string): string[] {
  return value.split('\n').filter(Boolean);
}

function safeRelative(root: string, path: string): string {
  const value = relative(root, path);
  if (value === '' || value === '..' || value.startsWith(`..${sep}`)) {
    throw new Error(`path is outside repository: ${path}`);
  }
  return value.split(sep).join('/');
}

export class GitImplementationPublisher implements ScaffoldPublisher {
  readonly #repoRoot: string;
  readonly #process: ProcessPort;
  readonly #timeoutMs: number;

  constructor(options: {
    repoRoot: string;
    process?: ProcessPort;
    timeoutMs?: number;
  }) {
    this.#repoRoot = options.repoRoot;
    this.#process = options.process ?? new SpawnProcessPort();
    this.#timeoutMs = options.timeoutMs ?? 60_000;
  }

  async #git(args: string[], allowExitCodes: number[] = [0], attempts = 1) {
    let lastError = '';
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const result = await this.#process.run({
        command: 'git',
        args,
        cwd: this.#repoRoot,
        timeoutMs: this.#timeoutMs,
      });
      if (
        !result.timedOut &&
        result.exitCode !== null &&
        allowExitCodes.includes(result.exitCode)
      ) {
        return result;
      }
      lastError =
        result.stderr.trim() || `git ${args[0] ?? ''} failed or timed out`;
      if (attempt < attempts) {
        await new Promise((resolve) =>
          setTimeout(resolve, 50 * 2 ** (attempt - 1)),
        );
      }
    }
    throw new Error(lastError);
  }

  async #gh(args: string[]) {
    let lastError = '';
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const result = await this.#process.run({
        command: 'gh',
        args,
        cwd: this.#repoRoot,
        timeoutMs: this.#timeoutMs,
      });
      if (!result.timedOut && result.exitCode === 0) return result;
      lastError = result.stderr.trim() || 'gh command failed or timed out';
      if (attempt < 3) {
        await new Promise((resolve) =>
          setTimeout(resolve, 50 * 2 ** (attempt - 1)),
        );
      }
    }
    throw new Error(lastError);
  }

  async publish(input: {
    item: QueuedImplementation;
    scaffold: ScaffoldResult;
  }): Promise<{ branch: string; scaffoldSha: string }> {
    const branch = `rule/${input.item.job.ruleId}${
      input.item.job.attempt > 1 ? `-a${String(input.item.job.attempt)}` : ''
    }`;
    const directory = safeRelative(this.#repoRoot, input.scaffold.directory);
    const metaPath = `${directory}/meta.json`;
    const specPath = `${directory}/SPEC.json`;
    const remote = await this.#git(
      ['ls-remote', '--exit-code', '--heads', 'origin', `refs/heads/${branch}`],
      [0, 2],
      3,
    );
    if (remote.exitCode === 0) {
      const expectedMeta = await readFile(input.scaffold.metaPath, 'utf8');
      const expectedSpec = await readFile(input.scaffold.specPath, 'utf8');
      await rm(input.scaffold.directory, { recursive: true, force: true });
      await this.#git(
        ['fetch', '--depth=2', 'origin', `refs/heads/${branch}`],
        [0],
        3,
      );
      await this.#git(['checkout', '-B', branch, 'FETCH_HEAD']);
      const headSha = (await this.#git(['rev-parse', 'HEAD'])).stdout.trim();
      const scaffoldSha = input.item.job.scaffoldSha ?? headSha;
      const [meta, spec, ancestor, changed, recordedMeta, recordedSpec] =
        await Promise.all([
          readFile(input.scaffold.metaPath, 'utf8'),
          readFile(input.scaffold.specPath, 'utf8'),
          this.#git(
            ['merge-base', '--is-ancestor', scaffoldSha, 'HEAD'],
            [0, 1],
          ),
          this.#git([
            'diff-tree',
            '--no-commit-id',
            '--name-only',
            '-r',
            scaffoldSha,
          ]),
          this.#git(['show', `${scaffoldSha}:${metaPath}`]),
          this.#git(['show', `${scaffoldSha}:${specPath}`]),
        ]);
      if (
        meta !== expectedMeta ||
        spec !== expectedSpec ||
        ancestor.exitCode !== 0 ||
        recordedMeta.stdout !== expectedMeta ||
        recordedSpec.stdout !== expectedSpec ||
        sha256(meta) !== input.scaffold.metaSha256 ||
        sha256(spec) !== input.scaffold.specSha256 ||
        JSON.stringify(lines(changed.stdout).sort()) !==
          JSON.stringify([metaPath, specPath].sort())
      ) {
        throw new Error('remote scaffold branch does not match queued job');
      }
      return { branch, scaffoldSha };
    }
    await this.#git(['checkout', '-b', branch]);
    await this.#git(['add', '--', metaPath, specPath]);
    await this.#git([
      'commit',
      '-m',
      `chore(rules): scaffold ${input.item.job.ruleId}`,
    ]);
    const sha = (await this.#git(['rev-parse', 'HEAD'])).stdout.trim();
    await this.#git(['push', '--set-upstream', 'origin', branch], [0], 3);
    return { branch, scaffoldSha: sha };
  }

  async recoverImplementation(input: {
    item: QueuedImplementation;
    scaffold: ScaffoldResult;
    branch: string;
    scaffoldSha: string;
  }): Promise<{ prNumber: number; headSha: string } | null> {
    const headSha = (await this.#git(['rev-parse', 'HEAD'])).stdout.trim();
    if (headSha === input.scaffoldSha) return null;
    const directory = safeRelative(this.#repoRoot, input.scaffold.directory);
    const [local, history, changed] = await Promise.all([
      inspectGeneratedRule(input.scaffold),
      this.inspect(input),
      this.#git(['diff', '--name-only', input.scaffoldSha, 'HEAD', '--']),
    ]);
    const expected = [
      `${directory}/rule.ts`,
      `${directory}/rule.test.ts`,
    ].sort();
    const violations = [
      ...(local.ok ? [] : local.violations),
      ...history,
      ...(JSON.stringify(lines(changed.stdout).sort()) ===
      JSON.stringify(expected)
        ? []
        : ['git: generated commit contains unexpected paths']),
    ];
    if (violations.length > 0) {
      throw new Error(
        `cannot recover generated commit: ${violations.join('; ')}`,
      );
    }
    return this.publishImplementation(input);
  }

  async inspect(input: {
    item: QueuedImplementation;
    scaffold: ScaffoldResult;
    branch: string;
    scaffoldSha: string;
  }): Promise<string[]> {
    const violations: string[] = [];
    const directory = safeRelative(this.#repoRoot, input.scaffold.directory);
    const metaPath = `${directory}/meta.json`;
    const specPath = `${directory}/SPEC.json`;
    const allowed = new Set([
      `?? ${directory}/rule.ts`,
      `?? ${directory}/rule.test.ts`,
      ` M ${directory}/rule.ts`,
      ` M ${directory}/rule.test.ts`,
      `M  ${directory}/rule.ts`,
      `M  ${directory}/rule.test.ts`,
    ]);
    const [branch, ancestor, status, scaffoldFiles, meta, spec] =
      await Promise.all([
        this.#git(['branch', '--show-current']),
        this.#git(
          ['merge-base', '--is-ancestor', input.scaffoldSha, 'HEAD'],
          [0, 1],
        ),
        this.#git(['status', '--porcelain=v1', '--untracked-files=all']),
        this.#git([
          'diff-tree',
          '--no-commit-id',
          '--name-only',
          '-r',
          input.scaffoldSha,
        ]),
        this.#git(['show', `${input.scaffoldSha}:${metaPath}`]),
        this.#git(['show', `${input.scaffoldSha}:${specPath}`]),
      ]);
    if (branch.stdout.trim() !== input.branch) {
      violations.push('git: current branch differs from deterministic branch');
    }
    if (ancestor.exitCode !== 0) {
      violations.push('git: scaffold commit is not an ancestor of HEAD');
    }
    for (const entry of statusLines(status.stdout)) {
      if (!allowed.has(entry)) violations.push(`${entry}: change outside rule`);
    }
    if (
      JSON.stringify(lines(scaffoldFiles.stdout).sort()) !==
      JSON.stringify([metaPath, specPath].sort())
    ) {
      violations.push('git: scaffold commit contains unexpected paths');
    }
    if (sha256(meta.stdout) !== input.scaffold.metaSha256) {
      violations.push('meta.json: scaffold blob differs from recorded SHA');
    }
    if (sha256(spec.stdout) !== input.scaffold.specSha256) {
      violations.push('SPEC.json: scaffold blob differs from recorded SHA');
    }
    return violations;
  }

  async publishImplementation(input: {
    item: QueuedImplementation;
    scaffold: ScaffoldResult;
    branch: string;
    scaffoldSha: string;
  }): Promise<{ prNumber: number; headSha: string }> {
    const directory = safeRelative(this.#repoRoot, input.scaffold.directory);
    const before = (await this.#git(['rev-parse', 'HEAD'])).stdout.trim();
    if (before === input.scaffoldSha) {
      await this.#git([
        'add',
        '--',
        `${directory}/rule.ts`,
        `${directory}/rule.test.ts`,
      ]);
      await this.#git([
        'commit',
        '-m',
        `feat(rules): implement ${input.item.job.ruleId}`,
      ]);
    } else {
      const status = await this.#git([
        'status',
        '--porcelain=v1',
        '--untracked-files=all',
      ]);
      if (statusLines(status.stdout).length > 0) {
        throw new Error('recovered generated commit has uncommitted changes');
      }
    }
    const headSha = (await this.#git(['rev-parse', 'HEAD'])).stdout.trim();
    await this.#git(['push', 'origin', input.branch], [0], 3);
    const existing = JSON.parse(
      (
        await this.#gh([
          'pr',
          'list',
          '--head',
          input.branch,
          '--state',
          'open',
          '--limit',
          '1',
          '--json',
          'number,headRefOid',
        ])
      ).stdout || '[]',
    ) as Array<{ number: number; headRefOid: string }>;
    if (existing[0]) {
      if (existing[0].headRefOid !== headSha) {
        throw new Error('existing PR head differs from generated commit');
      }
      return { prNumber: existing[0].number, headSha };
    }
    const body = [
      `Proposal: ${input.item.proposal.id}`,
      '',
      `Rule: ${input.item.job.ruleId}`,
      '',
      `SPEC summary: ${input.item.spec.summary}`,
      '',
      '<!-- daifugo-pipeline',
      `scaffold-sha: ${input.scaffoldSha}`,
      'end-daifugo-pipeline -->',
      '',
      '- [ ] SPEC/meta match the approved proposal',
      '- [ ] Generated hooks and Effects stay within the contract',
      '- [ ] CI is green',
    ].join('\n');
    await this.#gh([
      'pr',
      'create',
      '--base',
      'main',
      '--head',
      input.branch,
      '--label',
      'rule-change',
      '--title',
      `Rule: ${input.item.spec.name}`,
      '--body',
      body,
    ]);
    const created = JSON.parse(
      (
        await this.#gh([
          'pr',
          'list',
          '--head',
          input.branch,
          '--state',
          'open',
          '--limit',
          '1',
          '--json',
          'number,headRefOid',
        ])
      ).stdout || '[]',
    ) as Array<{ number: number; headRefOid: string }>;
    if (!created[0] || created[0].headRefOid !== headSha) {
      throw new Error('created PR could not be verified');
    }
    return { prNumber: created[0].number, headSha };
  }
}
