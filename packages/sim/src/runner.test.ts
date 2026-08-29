import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type { RuleModule } from '@daifugo/core';
import { describe, expect, it } from 'vitest';

import { rule as jokersRule } from './test-fixtures/jokers-rule.js';
import { rule as sequenceRule } from './test-fixtures/sequence-rule.js';
import { rule as simRule } from './test-fixtures/sim-rule.js';
import {
  isAiCompatibilityFailure,
  ruleChainEntries,
  runAiRuleSimulations,
  runRuleSimulations,
  simulationViolations,
} from './runner.js';

async function bundle(fixture: RuleModule, path: string) {
  const moduleUrl = new URL(path, import.meta.url);
  return {
    module: fixture,
    moduleUrl: moduleUrl.href,
    bundleHash: createHash('sha256')
      .update(await readFile(moduleUrl))
      .digest('hex'),
  };
}

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
  it('soft deadlineの部分探索はAI互換性違反にせず、異常fallbackだけを拒否する', () => {
    expect(isAiCompatibilityFailure('none')).toBe(false);
    expect(isAiCompatibilityFailure('partial-search')).toBe(false);
    expect(isAiCompatibilityFailure('heuristic')).toBe(true);
    expect(isAiCompatibilityFailure('engine-fallback')).toBe(true);
  });

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

  it('releaseではnew-onlyとallを別々に実行できる', () => {
    const modules = [module('r0001-one'), module('r0002-two')];
    const standalone = runRuleSimulations({
      modules,
      newRuleId: 'r0002-two',
      games: 1,
      seeds: 1,
      configurations: ['new-only'],
    });
    const all = runRuleSimulations({
      modules,
      games: 1,
      seeds: 1,
      configurations: ['all'],
    });

    expect(standalone.map((run) => run.configuration)).toEqual(['new-only']);
    expect(all.map((run) => run.configuration)).toEqual(['all']);
    expect(simulationViolations([...standalone, ...all])).toEqual([]);
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

  it('meta.engineFeaturesをRuleChainEntryへ転記し、未宣言は省略する', () => {
    const withFeatures = module('r0001-jokers');
    withFeatures.meta = {
      ...withFeatures.meta,
      engineFeatures: ['jokers', 'sequence'],
    };
    const entries = ruleChainEntries([withFeatures, module('r0002-plain')]);
    expect(entries[0]!.engineFeatures).toEqual(['jokers', 'sequence']);
    expect(entries[1]!.engineFeatures).toBeUndefined();
    expect('engineFeatures' in entries[1]!).toBe(false);
  });

  it('engineFeatures宣言つきルールのsimulationを完走し、ジョーカー2枚が実際に配られる', () => {
    const dealtIds = new Set<string>();
    const jokers = module('r0001-jokers', {
      onGameStart(context) {
        for (const player of context.game.players) {
          for (const card of player.hand) dealtIds.add(card.id);
        }
        return [];
      },
    });
    jokers.meta = { ...jokers.meta, engineFeatures: ['jokers'] };
    const runs = runRuleSimulations({
      modules: [jokers],
      newRuleId: 'r0001-jokers',
      games: 1,
      seeds: 1,
    });
    expect(simulationViolations(runs)).toEqual([]);
    // 54 枚デッキが実際に配られている(JK0/JK1 が初期手札に存在する)。
    expect(dealtIds.has('JK0')).toBe(true);
    expect(dealtIds.has('JK1')).toBe(true);
    expect(dealtIds.size).toBe(54);
  });

  it('jokers宣言ルールでAI simulationがフォールバックせず完走する', async () => {
    const runs = await runAiRuleSimulations({
      bundles: [
        await bundle(
          jokersRule as RuleModule,
          './test-fixtures/jokers-rule.js',
        ),
      ],
      newRuleId: jokersRule.meta.ruleId,
      games: 1,
      seeds: 1,
    });
    // runAiRuleSimulations は warmup がフォールバックすると throw するため、
    // 完走そのものが warmup 非フォールバックの検証になる。
    expect(runs).toHaveLength(2);
    expect(simulationViolations(runs)).toEqual([]);
    expect(runs.every((run) => (run.aiStats?.moves ?? 0) > 0)).toBe(true);
    expect(runs.every((run) => run.aiStats?.fallbackRate === 0)).toBe(true);
  }, 20_000);

  it('sequence宣言ルール単体とjokers併用のAI simulationがフォールバックせず完走する', async () => {
    // 'new-only' 構成 = sequence 単体、'all' 構成 = sequence + jokers 併用。
    const runs = await runAiRuleSimulations({
      bundles: [
        await bundle(
          sequenceRule as RuleModule,
          './test-fixtures/sequence-rule.js',
        ),
        await bundle(
          jokersRule as RuleModule,
          './test-fixtures/jokers-rule.js',
        ),
      ],
      newRuleId: sequenceRule.meta.ruleId,
      games: 1,
      seeds: 1,
    });
    expect(runs).toHaveLength(2);
    expect(simulationViolations(runs)).toEqual([]);
    expect(runs.every((run) => (run.aiStats?.moves ?? 0) > 0)).toBe(true);
    expect(runs.every((run) => run.aiStats?.fallbackRate === 0)).toBe(true);
  }, 40_000);
});
