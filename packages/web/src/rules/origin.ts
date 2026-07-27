import type { RuleCatalogKind } from '@daifugo/core';

export interface RuleOriginLabel {
  badge: string;
  sentence: string | null;
}

export function ruleOriginLabel(
  kind: RuleCatalogKind,
  prefecture: string | null,
): RuleOriginLabel {
  if (kind === 'original') {
    return { badge: 'オリジナル', sentence: null };
  }
  if (!prefecture) {
    return { badge: 'ローカル(県の記載なし)', sentence: null };
  }
  return {
    badge: `報告: ${prefecture}`,
    sentence: `${prefecture}で遊ばれていた報告`,
  };
}
