import type { CardRank, RuleModule } from '@daifugo/core';

export const rule: RuleModule = {
  meta: {
    ruleId: 'r0004-no-finish-with-two',
    name: '2あがり禁止',
    description:
      '手札を出し切る最後の手に、通常時は2、革命中は3が含まれていた場合、そのプレイヤーを反則あがりとして最低順位にする。一時的な強さ逆転では禁止対象を切り替えない。',
    kind: 'local',
    proposalId: '01KYQNNS24A33CY3K67FKTP6S2',
    contractVersion: 1,
    messages: {},
  },
  hooks: {
    afterPlay(context, play) {
      const player = context.game.field.current?.by;
      if (player === undefined) {
        return [];
      }
      const finished = context.game.players.some(
        (candidate) =>
          candidate.id === player && candidate.status === 'finished',
      );
      if (!finished) {
        return [];
      }

      const forbiddenRank: CardRank =
        context.game.strength.revolution === true ? '3' : '2';
      const violates = play.cards.some(
        (card) => card.kind === 'natural' && card.rank === forbiddenRank,
      );
      return violates ? [{ type: 'forceRank', player, rank: 'lowest' }] : [];
    },
  },
};
