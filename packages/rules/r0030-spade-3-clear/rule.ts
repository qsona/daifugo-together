import type { RuleModule } from '@daifugo/core';

export const rule: RuleModule = {
  meta: {
    ruleId: 'r0030-spade-3-clear',
    name: 'スペード3返し',
    description:
      'スペードの3を含む合法な手を出すと場を流し、そのカードを出したプレイヤーが次の場を開始する。',
    kind: 'local',
    prefecture: '神奈川県',
    proposalId: '01KZDYX97M1XMC3P8SSX5T4ANT',
    contractVersion: 1,
    messages: {},
  },
  hooks: {
    afterPlay(_context, play) {
      const containsSpadeThree = play.cards.some(
        (card) =>
          card.kind === 'natural' && card.suit === 'spade' && card.rank === '3',
      );

      return containsSpadeThree ? [{ type: 'clearField' }] : [];
    },
  },
};
