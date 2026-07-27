import { describe, expect, it } from 'vitest';

import { ruleOriginLabel } from './origin';

describe('ruleOriginLabel', () => {
  it('県ありローカルを出自の報告として表す', () => {
    expect(ruleOriginLabel('local', '埼玉県')).toEqual({
      badge: '報告: 埼玉県',
      sentence: '埼玉県で遊ばれていた報告',
    });
  });

  it('県なしローカルとオリジナルを断定せず表す', () => {
    expect(ruleOriginLabel('local', null)).toEqual({
      badge: 'ローカル(県の記載なし)',
      sentence: null,
    });
    expect(ruleOriginLabel('original', null)).toEqual({
      badge: 'オリジナル',
      sentence: null,
    });
  });
});
