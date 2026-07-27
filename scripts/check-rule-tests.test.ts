import { describe, expect, it } from 'vitest';

import { validateRuleTestReport } from './check-rule-tests.mjs';

describe('rule test quality gate', () => {
  it('3件以上のtest caseを許可する', () => {
    expect(validateRuleTestReport({ numTotalTests: 3 })).toEqual([]);
  });

  it('test caseが3件未満なら拒否する', () => {
    expect(validateRuleTestReport({ numTotalTests: 2 })).toEqual([
      'rule.test.ts must execute at least 3 tests (actual=2)',
    ]);
  });

  it('file assertion結果からも件数を集計する', () => {
    expect(
      validateRuleTestReport({
        testResults: [
          { assertionResults: [{}, {}] },
          { assertionResults: [{}] },
        ],
      }),
    ).toEqual([]);
  });
});
