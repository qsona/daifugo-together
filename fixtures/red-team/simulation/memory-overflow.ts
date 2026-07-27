import type { RuleModule } from '@daifugo/core';

export const memoryOverflowRule: RuleModule = {
  meta: {
    ruleId: 'r9003-memory-overflow',
    name: 'memory overflow fixture',
    description: 'exceeds the rule memory value quota',
    kind: 'original',
    proposalId: 'red-team-memory-overflow',
    contractVersion: 1,
    messages: {},
  },
  hooks: {
    onGameStart() {
      return [
        {
          type: 'setMemory',
          scope: 'game',
          key: 'overflow',
          value: 'x'.repeat(2_000),
        },
      ];
    },
  },
};
