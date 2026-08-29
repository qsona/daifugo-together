import type { RuleContext, RuleModule, Standing } from '@daifugo/core';

function previousPlayer(
  context: RuleContext,
  standing: Standing,
): string | undefined {
  return context.setHistory
    .at(-1)
    ?.standings.find((result) => result.standing === standing)?.player;
}

export const rule: RuleModule = {
  meta: {
    ruleId: 'r0036-gekokujo',
    name: '下剋上',
    description:
      '前ゲームの大貧民が次ゲームで最初に正常なあがりを成立させた場合、前ゲームの富豪を3位、前ゲームの貧民を2位に確定する。前ゲームの大富豪には既存の都落ちを適用する。',
    kind: 'local',
    proposalId: '01M079YENPW3XJBEBPB411MQAJ',
    contractVersion: 1,
    messages: {},
  },
  hooks: {
    afterPlay(context) {
      const actor = context.game.field.current?.by;
      const actorState = context.game.players.find(
        (player) => player.id === actor,
      );
      const previousDaihinmin = previousPlayer(context, 4);
      if (!actor || actor !== previousDaihinmin || actorState?.standing !== 1) {
        return [];
      }

      const previousFugo = previousPlayer(context, 2);
      const previousHinmin = previousPlayer(context, 3);
      if (!previousFugo || !previousHinmin) return [];

      return [
        {
          type: 'forceRank',
          player: previousFugo,
          rank: 3,
          when: { player: actor, standing: 1 },
        },
        {
          type: 'forceRank',
          player: previousHinmin,
          rank: 2,
          when: { player: actor, standing: 1 },
        },
      ];
    },
  },
};
