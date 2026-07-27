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
});
