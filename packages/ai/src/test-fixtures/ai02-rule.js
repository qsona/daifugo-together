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
    modifyLegality: (context, _play, base) => {
      if (
        context.memory.game.requireSuitBindingReset === true &&
        context.game.suitBindingResetAfter === null
      ) {
        return { legal: false };
      }
      return base;
    },
    modifyStrength: (context, base) => {
      if (context.memory.game.throw === true) {
        throw new Error('AI-02 fixture hook failure');
      }
      const watchedPlayer = context.memory.game.watchPlayer;
      const watchedCard = context.memory.game.watchCard;
      const watchedCardIsHeld =
        typeof watchedPlayer === 'string' &&
        typeof watchedCard === 'string' &&
        context.game.players
          .find((player) => player.id === watchedPlayer)
          ?.hand.some((card) => card.id === watchedCard);
      return context.memory.game.force === true ||
        watchedCardIsHeld ||
        (context.memory.game.disableRandom !== true && context.rng.int(2) === 1)
        ? { ranking: [...base.ranking].reverse() }
        : base;
    },
    afterPlay: () => [{ type: 'announce', messageKey: 'fired' }],
  },
};
