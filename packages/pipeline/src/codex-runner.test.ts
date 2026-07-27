import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SubscriptionCodexRunner } from './codex-runner.js';
import type { ProcessPort } from './process.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'codex-runner-'));
  directories.push(directory);
  const promptPath = join(directory, 'prompt.md');
  await writeFile(promptPath, 'Create rule.ts and rule.test.ts.\n');
  return { directory, promptPath };
}

describe('SubscriptionCodexRunner', () => {
  it('API keyを使わずsubscription CLIをworkspace-writeで起動する', async () => {
    const input = await fixture();
    const run = vi.fn<ProcessPort['run']>(async ({ cwd }) => {
      await writeFile(join(cwd, 'rule.ts'), 'export {};\n');
      await writeFile(join(cwd, 'rule.test.ts'), 'export {};\n');
      return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
    });
    const runner = new SubscriptionCodexRunner({
      process: { run },
      timeoutMs: 123,
    });

    await expect(runner.run(input)).resolves.toEqual({ status: 'completed' });
    expect(run).toHaveBeenCalledWith({
      command: 'codex',
      args: [
        'exec',
        '--cd',
        input.directory,
        '--sandbox',
        'workspace-write',
        '--ephemeral',
        '-',
      ],
      cwd: input.directory,
      stdin: 'Create rule.ts and rule.test.ts.\n',
      timeoutMs: 123,
    });
  });

  it.each([
    [
      {
        exitCode: null,
        stdout: '',
        stderr: '',
        timedOut: true,
      },
      'codex_timeout',
    ],
    [
      {
        exitCode: 1,
        stdout: '',
        stderr: 'subscription unavailable',
        timedOut: false,
      },
      'infra',
    ],
    [
      {
        exitCode: 0,
        stdout: '',
        stderr: '',
        timedOut: false,
      },
      'codex_empty',
    ],
  ] as const)('異常終了を内部区分 %s として返す', async (result, code) => {
    const input = await fixture();
    const runner = new SubscriptionCodexRunner({
      process: { run: async () => result },
    });
    await expect(runner.run(input)).resolves.toMatchObject({
      status: 'failed',
      code,
    });
  });
});
