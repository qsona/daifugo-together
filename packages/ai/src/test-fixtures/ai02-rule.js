export const rule = {
  meta: {
    ruleId: 'r9000-ai-follow',
    name: 'AI追従fixture',
    description: '決定的RNGで強さを反転し全プレイを通知する',
    kind: 'original',
    proposalId: 'ai02-fixture',
    contractVersion: 1,
    messages: {
      fired: 'AI追従fixture',
    },
  },
  hooks: {
    modifyStrength: (context, base) => {
      if (context.memory.game.throw === true) {
        throw new Error('AI-02 fixture hook failure');
      }
      return context.memory.game.force === true || context.rng.int(2) === 1
        ? { ranking: [...base.ranking].reverse() }
        : base;
    },
    afterPlay: () => [{ type: 'announce', messageKey: 'fired' }],
  },
};
