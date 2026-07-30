import type { RuleModule } from '@daifugo/core';

export const rule: RuleModule = {
  meta: {
    ruleId: 'r0006-two-jokers-all-mighty',
    name: 'ジョーカー',
    description:
      'ジョーカー2枚を有効にする。ジョーカーは単体では革命の影響を受けない最強カードで、同一ランクの組および階段では任意のカードを代用する。ジョーカーを含む手で手札を出し切ったプレイヤーは、反則あがりとして最下位にする。',
    kind: 'local',
    proposalId: '01KYQNNS31SPSYD7A4DME9Q2D1',
    contractVersion: 1,
    engineFeatures: ['sequence', 'jokers'],
    messages: {},
  },
  hooks: {
    afterPlay(context, play) {
      if (!play.cards.some((card) => card.kind === 'joker')) {
        return [];
      }

      const actor = context.game.field.current?.by;
      const actorState = context.game.players.find(
        (player) => player.id === actor,
      );
      return actor && actorState?.hand.length === 0
        ? [{ type: 'forceRank', player: actor, rank: 'lowest' }]
        : [];
    },
  },
};
