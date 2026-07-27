import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { QueuedImplementation } from '@daifugo/server';
import { afterEach, describe, expect, it } from 'vitest';

import { GitImplementationPublisher } from './git-publisher.js';
import {
  SpawnProcessPort,
  type ProcessPort,
  type ProcessResult,
} from './process.js';
import { createRuleScaffold } from './scaffold.js';

const execute = promisify(execFile);
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

function queued(): QueuedImplementation {
  return {
    job: {
      id: 1,
      proposalId: 'proposal-1',
      phase: 'queued',
      attempt: 1,
      ciRerun: 0,
      ruleId: 'r0001-yagiri',
      slug: 'yagiri',
      branch: null,
      prNumber: null,
      headSha: null,
      mergeSha: null,
      scaffoldSha: null,
      promptVersion: null,
      errorCode: null,
      errorNote: null,
      createdAt: 1,
      updatedAt: 1,
    },
    proposal: {
      id: 'proposal-1',
      kind: 'local',
      prefectureCode: '11',
      prefecture: '埼玉県',
      name: '八切り',
      body: '8を出したら場を流す。',
    },
    passedCheckId: 2,
    approvedJudgementId: 3,
    spec: {
      specVersion: 1,
      name: '八切り',
      summary: '8を含むプレイの直後に場を流す。',
      hooks: ['afterPlay'],
      effects: ['clearField'],
      testPoints: ['8で発動する'],
      notes: '',
      source: {
        kind: 'local',
        title: '八切り',
        body: '8を出したら場を流す。',
      },
    },
    scaffoldMeta: { slug: 'yagiri', messages: {} },
  };
}

async function git(cwd: string, ...args: string[]) {
  return execute('git', args, { cwd });
}

async function repositories() {
  const root = await mkdtemp(join(tmpdir(), 'git-publisher-'));
  directories.push(root);
  const remote = join(root, 'remote.git');
  const seed = join(root, 'seed');
  const first = join(root, 'first');
  const recovered = join(root, 'recovered');
  await git(root, 'init', '--bare', remote);
  await git(root, 'init', seed);
  await git(seed, 'config', 'user.name', 'Pipeline Test');
  await git(seed, 'config', 'user.email', 'pipeline@example.test');
  await writeFile(join(seed, 'README.md'), '# fixture\n');
  await git(seed, 'add', 'README.md');
  await git(seed, 'commit', '-m', 'initial');
  await git(seed, 'branch', '-M', 'main');
  await git(seed, 'remote', 'add', 'origin', remote);
  await git(seed, 'push', '-u', 'origin', 'main');
  await git(root, 'clone', '--branch', 'main', remote, first);
  await git(root, 'clone', '--branch', 'main', remote, recovered);
  for (const path of [first, recovered]) {
    await git(path, 'config', 'user.name', 'Pipeline Test');
    await git(path, 'config', 'user.email', 'pipeline@example.test');
  }
  return { first, recovered };
}

describe('GitImplementationPublisher', () => {
  it('scaffoldを先行pushし、再起動時は同一remote固定点を回復する', async () => {
    const { first, recovered } = await repositories();
    const item = queued();
    const firstScaffold = await createRuleScaffold(
      item,
      join(first, 'packages/rules'),
    );
    const published = await new GitImplementationPublisher({
      repoRoot: first,
    }).publish({ item, scaffold: firstScaffold });

    const recoveredScaffold = await createRuleScaffold(
      item,
      join(recovered, 'packages/rules'),
    );
    const recoveredPublisher = new GitImplementationPublisher({
      repoRoot: recovered,
    });
    await expect(
      recoveredPublisher.publish({ item, scaffold: recoveredScaffold }),
    ).resolves.toEqual(published);

    await writeFile(
      join(recoveredScaffold.directory, 'rule.ts'),
      'export const rule = { hooks: {} };\n',
    );
    await writeFile(
      join(recoveredScaffold.directory, 'rule.test.ts'),
      'export {};\n',
    );
    await expect(
      recoveredPublisher.inspect({
        item,
        scaffold: recoveredScaffold,
        ...published,
      }),
    ).resolves.toEqual([]);

    const spawned = new SpawnProcessPort();
    let listCount = 0;
    const ghCalls: string[][] = [];
    const processPort: ProcessPort = {
      run: async (command): Promise<ProcessResult> => {
        if (command.command !== 'gh') return spawned.run(command);
        ghCalls.push(command.args);
        if (command.args[0] === 'pr' && command.args[1] === 'create') {
          return {
            exitCode: 0,
            stdout: 'https://example.test/pr/42\n',
            stderr: '',
            timedOut: false,
          };
        }
        listCount += 1;
        const head =
          listCount === 1
            ? null
            : (
                await spawned.run({
                  command: 'git',
                  args: ['rev-parse', 'HEAD'],
                  cwd: recovered,
                  timeoutMs: 10_000,
                })
              ).stdout.trim();
        return {
          exitCode: 0,
          stdout:
            head === null
              ? '[]'
              : JSON.stringify([{ number: 42, headRefOid: head }]),
          stderr: '',
          timedOut: false,
        };
      },
    };
    const pullRequest = await new GitImplementationPublisher({
      repoRoot: recovered,
      process: processPort,
    }).publishImplementation({
      item,
      scaffold: recoveredScaffold,
      ...published,
    });
    expect(pullRequest).toMatchObject({
      prNumber: 42,
      headSha: expect.stringMatching(/^[0-9a-f]{40}$/u),
    });
    const createArguments = ghCalls
      .find((args) => args[0] === 'pr' && args[1] === 'create')
      ?.join('\n');
    expect(createArguments).toContain(`SPEC summary: ${item.spec.summary}`);
    expect(createArguments).toContain(
      `base-sha: ${(await git(recovered, 'rev-parse', `${published.scaffoldSha}^`)).stdout.trim()}`,
    );
    await expect(
      new GitImplementationPublisher({
        repoRoot: recovered,
        process: processPort,
      }).recoverImplementation({
        item: {
          ...item,
          job: {
            ...item.job,
            phase: 'implementing',
            branch: published.branch,
            scaffoldSha: published.scaffoldSha,
            promptVersion: 'cx02-v3',
          },
        },
        scaffold: recoveredScaffold,
        ...published,
      }),
    ).resolves.toEqual(pullRequest);
    await expect(
      git(
        recovered,
        'show',
        `origin/${published.branch}:packages/rules/r0001-yagiri/rule.ts`,
      ),
    ).resolves.toMatchObject({
      stdout: 'export const rule = { hooks: {} };\n',
    });

    await writeFile(join(recovered, 'outside.txt'), 'unexpected\n');
    await expect(
      recoveredPublisher.inspect({
        item,
        scaffold: recoveredScaffold,
        ...published,
      }),
    ).resolves.toContain('?? outside.txt: change outside rule');
  });
});
