import { describe, expect, it } from 'vitest';

import { LocalImplementationVerifier } from './implementation-verifier.js';
import type { ProcessPort } from './process.js';

describe('local implementation verifier', () => {
  it('workspace全体のrule型検査後に対象rule testだけを実行する', async () => {
    const inputs: Parameters<ProcessPort['run']>[0][] = [];
    const verifier = new LocalImplementationVerifier({
      run: async (input) => {
        inputs.push(input);
        return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
      },
    });
    await expect(
      verifier.verify({
        workspace: '/workspace',
        scaffold: {
          directory: '/workspace/packages/rules/r0001-yagiri',
          metaPath: '/workspace/packages/rules/r0001-yagiri/meta.json',
          specPath: '/workspace/packages/rules/r0001-yagiri/SPEC.json',
          metaSha256: 'a',
          specSha256: 'b',
        },
      }),
    ).resolves.toEqual([]);
    expect(inputs).toMatchObject([
      {
        command: 'pnpm',
        args: ['--filter', '@daifugo/core', 'build'],
        cwd: '/workspace',
      },
      {
        command: 'pnpm',
        args: ['--filter', '@daifugo/rules', 'typecheck'],
        cwd: '/workspace',
      },
      {
        command: 'pnpm',
        args: [
          'exec',
          'vitest',
          'run',
          'packages/rules/r0001-yagiri/rule.test.ts',
        ],
        cwd: '/workspace',
      },
    ]);
  });

  it('型検査失敗時はtestを実行せず検収違反として返す', async () => {
    let calls = 0;
    const verifier = new LocalImplementationVerifier({
      run: async () => {
        calls += 1;
        if (calls === 1) {
          return {
            exitCode: 0,
            stdout: '',
            stderr: '',
            timedOut: false,
          };
        }
        return {
          exitCode: 2,
          stdout: '',
          stderr: 'type error',
          timedOut: false,
        };
      },
    });
    await expect(
      verifier.verify({
        workspace: '/workspace',
        scaffold: {
          directory: '/workspace/rule',
          metaPath: '/workspace/rule/meta.json',
          specPath: '/workspace/rule/SPEC.json',
          metaSha256: 'a',
          specSha256: 'b',
        },
      }),
    ).resolves.toEqual(['typecheck: type error']);
    expect(calls).toBe(2);
  });
});
