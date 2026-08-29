import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

import { cardDuplicationRule } from '../fixtures/red-team/simulation/card-duplication.js';
import { memoryOverflowRule } from '../fixtures/red-team/simulation/memory-overflow.js';
import { terminationEffectRule } from '../fixtures/red-team/simulation/termination-effect.js';
import {
  runRuleSimulations,
  simulationViolations,
} from '../packages/sim/src/runner.js';

const SOURCE_FIXTURES = [
  'outside-import.txt',
  'network.txt',
  'memory-explosion.txt',
  'infinite-loop.txt',
] as const;

describe('CX-03 red-team suite', () => {
  it.each(SOURCE_FIXTURES)(
    'source policyが%sを実行前に拒否する',
    async (fixture) => {
      const source = await readFile(
        join('fixtures/red-team/source', fixture),
        'utf8',
      );
      const eslint = new ESLint({ cwd: process.cwd() });
      const [result] = await eslint.lintText(source, {
        filePath: 'packages/rules/r9999-red-team/rule.ts',
      });

      expect(result?.messages.some((message) => message.severity === 2)).toBe(
        true,
      );
    },
  );

  it.each([
    ['card duplication', cardDuplicationRule],
    ['termination effect', terminationEffectRule],
    ['memory overflow', memoryOverflowRule],
  ] as const)('%s fixtureをsimulation gateが拒否する', (_name, rule) => {
    const runs = runRuleSimulations({
      modules: [rule],
      newRuleId: rule.meta.ruleId,
      games: 1,
      seeds: 1,
    });

    expect(simulationViolations(runs)).toEqual(
      expect.arrayContaining([expect.stringContaining('invalid-effect')]),
    );
  });

  it('native simulationの無限loopを外側のtimeoutで停止する', () => {
    const result = spawnSync(
      process.execPath,
      ['fixtures/red-team/simulation/infinite-loop-runner.mjs'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 500,
        killSignal: 'SIGKILL',
      },
    );

    expect(result.error).toMatchObject({ code: 'ETIMEDOUT' });
    expect(result.signal).toBe('SIGKILL');
  });

  it('PR smokeとrelease全量simulationがそれぞれ必須ゲートになっている', async () => {
    const prWorkflow = await readFile(
      '.github/workflows/rule-pr-checks.yml',
      'utf8',
    );
    const releaseWorkflow = await readFile('.github/workflows/ci.yml', 'utf8');

    expect(prWorkflow).toMatch(
      /simulation:\n\s+needs: quality\n\s+runs-on:[\s\S]*?timeout-minutes: 10/u,
    );
    expect(prWorkflow).toContain('--configuration new-only');
    expect(prWorkflow).toContain('--games 20 --seeds 1');
    expect(releaseWorkflow).toContain('release-simulation:');
    expect(releaseWorkflow).toContain("github.ref == 'refs/heads/release'");
    expect(releaseWorkflow).toContain('--configuration new-only');
    expect(releaseWorkflow).toContain('--configuration all');
    expect(releaseWorkflow).toContain('--games 200');
    expect(releaseWorkflow).toContain('--seeds 5');
  });
});
