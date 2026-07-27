import { describe, expect, it } from 'vitest';

import { validateRuleTestReport } from './check-rule-tests.mjs';

describe('rule test quality gate', () => {
  it('3件以上のtest caseを許可する', () => {
    expect(
      validateRuleTestReport({ numPassedTests: 3, numPendingTests: 0 }),
    ).toEqual([]);
  });

  it('test caseが3件未満なら拒否する', () => {
    expect(
      validateRuleTestReport({ numPassedTests: 2, numPendingTests: 0 }),
    ).toEqual(['rule.test.ts must pass at least 3 tests (actual=2)']);
  });

  it('file assertion結果からも件数を集計する', () => {
    expect(
      validateRuleTestReport({
        testResults: [
          {
            assertionResults: [{ status: 'passed' }, { status: 'passed' }],
          },
          { assertionResults: [{ status: 'passed' }] },
        ],
      }),
    ).toEqual([]);
  });

  it('3件すべてskipなら実行済みtestとして数えない', () => {
    expect(
      validateRuleTestReport({
        numTotalTests: 3,
        numPassedTests: 0,
        numPendingTests: 3,
      }),
    ).toEqual([
      'rule.test.ts must pass at least 3 tests (actual=0)',
      'rule.test.ts must not skip or defer tests (actual=3)',
    ]);
  });

  it('3件passしていてもpendingを残したtest fileを拒否する', () => {
    expect(
      validateRuleTestReport({
        numPassedTests: 3,
        numPendingTests: 1,
      }),
    ).toEqual(['rule.test.ts must not skip or defer tests (actual=1)']);
  });
});
