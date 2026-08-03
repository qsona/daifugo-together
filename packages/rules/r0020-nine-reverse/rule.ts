import type { RuleModule } from '@daifugo/core';

export const rule: RuleModule = {
  meta: {
    ruleId: 'r0020-nine-reverse',
    name: '9-リバース',
    description:
      '自然なランク9を含む手を出すと、現在の進行方向を1回反転する。同じ手に9が複数含まれていても、反転回数は増えない。',
    kind: 'local',
    prefecture: '東京都',
    proposalId: '01KZ1FMS68BBPNVWX9G4CZG5JH',
    contractVersion: 1,
    messages: {},
  },
  hooks: {
    afterPlay(_context, play) {
      const containsNaturalNine = play.cards.some(
        (card) => card.kind === 'natural' && card.rank === '9',
      );
      return containsNaturalNine ? [{ type: 'reverseTurnOrder' }] : [];
    },
  },
};
