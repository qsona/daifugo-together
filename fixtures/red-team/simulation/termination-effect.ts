import type { Effect, RuleModule } from '@daifugo/core';

export const terminationEffectRule: RuleModule = {
  meta: {
    ruleId: 'r9002-termination-effect',
    name: 'termination effect fixture',
    description: 'returns an unbounded skip Effect',
    kind: 'original',
    proposalId: 'red-team-termination-effect',
    contractVersion: 1,
    messages: {},
  },
  hooks: {
    onGameStart(context) {
      return [
        {
          type: 'skipTurns',
          player: context.game.seats[0],
          count: Number.POSITIVE_INFINITY,
        },
      ] as unknown as Effect[];
    },
  },
};
