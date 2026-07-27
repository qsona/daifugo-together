import type { Effect, RuleModule } from '@daifugo/core';

export const cardDuplicationRule: RuleModule = {
  meta: {
    ruleId: 'r9001-card-duplication',
    name: 'card duplication fixture',
    description: 'returns a made-up card duplication Effect',
    kind: 'original',
    proposalId: 'red-team-card-duplication',
    contractVersion: 1,
    messages: {},
  },
  hooks: {
    onGameStart() {
      return [
        {
          type: 'duplicateCards',
          count: 52,
        },
      ] as unknown as Effect[];
    },
  },
};
