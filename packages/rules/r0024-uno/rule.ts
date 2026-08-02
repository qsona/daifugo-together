import { generateCandidates, type RuleModule } from '@daifugo/core';

export const rule: RuleModule = {
  meta: {
    ruleId: 'r0024-uno',
    name: 'ウノ',
    description:
      '手を出した後、残り手札のすべてが単体、同一ランクの組、または階段として次の1回でまとめて出せる形であり、そのプレイから7渡しや10捨てなどの追加のカード選択・移動が発生しない場合、自動的に「ウノ！」と宣言する。',
    kind: 'local',
    prefecture: '東京都',
    proposalId: '01KZ1G5GKJPHV960J7CM65SAPY',
    contractVersion: 1,
    engineFeatures: ['sequence'],
    messages: {
      uno_announce: 'ウノ！',
    },
  },
  hooks: {
    afterPlay(context, play) {
      const requiresAdditionalCardAction = play.cards.some(
        (card) =>
          card.kind === 'natural' && (card.rank === '7' || card.rank === '10'),
      );
      if (requiresAdditionalCardAction) {
        return [];
      }

      const actor = context.game.field.current?.by;
      const hand = context.game.players.find(
        (player) => player.id === actor,
      )?.hand;
      if (!hand || hand.length === 0) {
        return [];
      }

      const canPlayEntireHand = generateCandidates(hand, ['sequence']).some(
        (candidate) => candidate.count === hand.length,
      );
      return canPlayEntireHand
        ? [{ type: 'announce', messageKey: 'uno_announce' }]
        : [];
    },
  },
};
