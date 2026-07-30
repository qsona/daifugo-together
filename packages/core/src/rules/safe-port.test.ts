import { describe, expect, it } from 'vitest';

import { BASE_STRENGTH_ORDER, type StrengthOrder } from '../play/strength.js';
import { NO_RULE_CHAIN_PORT } from './chain.js';
import type { RuleChainEntry, RuleContext, RuleModule } from './contract.js';
import { createInProcessRuleChainPort } from './in-process.js';
import { cloneValidStrengthOrder, safeModifyStrength } from './safe-port.js';

const entry = (ruleId: string, position: number): RuleChainEntry => ({
  ruleId,
  name: ruleId,
  position,
  priority: { score: 0, activatedAt: 0, ruleId },
  bundleHash: 'fixture',
  contractVersion: 1,
});

const meta = (ruleId: string): RuleModule['meta'] => ({
  ruleId,
  name: ruleId,
  description: 'fixture',
  kind: 'original',
  proposalId: 'fixture',
  contractVersion: 1,
  messages: {},
});

const context = {} as RuleContext;

describe('StrengthOrder safety', () => {
  it('正しい比較例外だけを複製して受け付ける', () => {
    const source = {
      ranking: [...BASE_STRENGTH_ORDER.ranking],
      comparisonOverrides: [{ stronger: '3', weaker: 'joker' }],
    };

    const cloned = cloneValidStrengthOrder(source);

    expect(cloned).toEqual(source);
    expect(cloned).not.toBe(source);
    expect(cloned?.comparisonOverrides).not.toBe(source.comparisonOverrides);
  });

  it.each([
    [{ stronger: '3', weaker: '3' }],
    [{ stronger: 'invalid', weaker: 'joker' }],
    [{ stronger: '3' }],
    [{ stronger: '3', weaker: 'joker', extra: true }],
  ])('不正な比較例外 %j を拒否する', (comparisonOverrides) => {
    expect(
      cloneValidStrengthOrder({
        ranking: [...BASE_STRENGTH_ORDER.ranking],
        comparisonOverrides,
      }),
    ).toBeNull();
  });

  it('比較例外を省略した後続ルールでも直前の値を維持する', () => {
    const firstEntry = entry('r-first', 0);
    const secondEntry = entry('r-second', 1);
    const first: RuleModule = {
      meta: meta(firstEntry.ruleId),
      hooks: {
        modifyStrength: (_context, base) => ({
          ...base,
          comparisonOverrides: [{ stronger: '3', weaker: 'joker' }],
        }),
      },
    };
    const second: RuleModule = {
      meta: meta(secondEntry.ruleId),
      hooks: {
        modifyStrength: (_context, base) => ({
          ranking: [...base.ranking].reverse(),
        }),
      },
    };

    const result = createInProcessRuleChainPort([first, second]).modifyStrength(
      [firstEntry, secondEntry],
      context,
      BASE_STRENGTH_ORDER,
    );

    expect(result.result.comparisonOverrides).toEqual([
      { stronger: '3', weaker: 'joker' },
    ]);
    expect(result.result.ranking).toEqual(
      [...BASE_STRENGTH_ORDER.ranking].reverse(),
    );
  });

  it('公開portが比較例外を省略してもbaseの値を維持する', () => {
    const base: StrengthOrder = {
      ...BASE_STRENGTH_ORDER,
      comparisonOverrides: [{ stronger: '3', weaker: 'joker' }],
    };
    const port = {
      ...NO_RULE_CHAIN_PORT,
      modifyStrength: () => ({
        result: { ranking: [...BASE_STRENGTH_ORDER.ranking].reverse() },
        influenced: [],
      }),
    };

    const result = safeModifyStrength(port, [], context, base);

    expect(result.result.comparisonOverrides).toEqual(base.comparisonOverrides);
  });
});
