import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type { RuleModule } from '@daifugo/core';
import { describe, expect, it } from 'vitest';

import { rule as simRule } from './test-fixtures/sim-rule.js';
import {
  runAiRuleSimulations,
  runRuleSimulations,
  simulationViolations,
} from './runner.js';

function module(id: string, hooks: RuleModule['hooks'] = {}): RuleModule {
  return {
    meta: {
      ruleId: id,
      name: id,
      description: id,
      kind: 'original',
      proposalId: `proposal-${id}`,
      contractVersion: 1,
      messages: {},
    },
    hooks,
  };
}

describe('CX-03 simulation runner', () => {
  it('既存simulation不変条件をworker AI 4席の着手で検証する', async () => {
    const moduleUrl = new URL('./test-fixtures/sim-rule.js', import.meta.url);
    const runs = await runAiRuleSimulations({
      bundles: [
        {
          module: simRule as RuleModule,
          moduleUrl: moduleUrl.href,
          bundleHash: createHash('sha256')
            .update(await readFile(moduleUrl))
            .digest('hex'),
        },
      ],
      newRuleId: simRule.meta.ruleId,
      games: 1,
      seeds: 1,
      budget: {
        softMs: 3,
        hardMs: 1_000,
        maxPlayouts: 1,
        sliceMs: 1,
      },
      maxMoveWallMs: 1_500,
    });

    expect(runs).toHaveLength(2);
    expect(simulationViolations(runs)).toEqual([]);
    expect(runs.every((run) => (run.aiStats?.moves ?? 0) > 0)).toBe(true);
    expect(runs.every((run) => run.aiStats?.fallbackRate === 0)).toBe(true);
  }, 20_000);

  it('new-only/allの2構成を固定seedで完走する', () => {
    const runs = runRuleSimulations({
      modules: [module('r0001-one'), module('r0002-two')],
      newRuleId: 'r0002-two',
      games: 2,
      seeds: 2,
    });

    expect(runs).toHaveLength(4);
    expect(new Set(runs.map((run) => run.configuration))).toEqual(
      new Set(['new-only', 'all']),
    );
    expect(simulationViolations(runs)).toEqual([]);
  });

  it('rule例外を握りつぶさずCI違反として報告する', () => {
    const runs = runRuleSimulations({
      modules: [
        module('r0001-broken', {
          onGameStart() {
            throw new Error('broken');
          },
        }),
      ],
      newRuleId: 'r0001-broken',
      games: 1,
      seeds: 1,
    });

    expect(simulationViolations(runs)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('r0001-broken/onGameStart: exception'),
      ]),
    );
  });

  it('不正Effectをsimulation不変条件違反として報告する', () => {
    const runs = runRuleSimulations({
      modules: [
        module('r0001-invalid', {
          onGameStart() {
            return [{ type: 'clearField' }];
          },
        }),
      ],
      newRuleId: 'r0001-invalid',
      games: 1,
      seeds: 1,
    });

    expect(simulationViolations(runs)).toEqual(
      expect.arrayContaining([expect.stringContaining('invalid-effect')]),
    );
  });
});
