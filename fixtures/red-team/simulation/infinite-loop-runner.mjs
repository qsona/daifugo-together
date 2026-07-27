import {
  createInProcessRuleChainPort,
  simulate,
} from '../../../packages/core/dist/index.js';

const ruleId = 'r9004-infinite-loop';
const rule = {
  meta: {
    ruleId,
    name: 'infinite loop fixture',
    description: 'never returns from onGameStart',
    kind: 'original',
    proposalId: 'red-team-infinite-loop',
    contractVersion: 1,
    messages: {},
  },
  hooks: {
    onGameStart() {
      while (true) {
        // The outer process timeout is the expected containment boundary.
      }
    },
  },
};

simulate({
  games: 1,
  seed: 'cx03:red-team:infinite-loop',
  ruleChain: [
    {
      ruleId,
      name: rule.meta.name,
      position: 0,
      priority: { score: 0, activatedAt: 0, ruleId },
      bundleHash: 'red-team-infinite-loop',
      contractVersion: 1,
    },
  ],
  port: createInProcessRuleChainPort([rule]),
});
