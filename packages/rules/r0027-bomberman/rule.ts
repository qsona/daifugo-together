import type { RuleModule } from '@daifugo/core';

const CHOICE_ID = 'bomberman_discard';

export const rule: RuleModule = {
  meta: {
    ruleId: 'r0027-bomberman',
    name: 'ボンバーマン',
    description:
      '階段を出したプレイヤーは、残り手札があれば構成枚数にかかわらず1枚を必ず選んで捨て札へ移す。',
    kind: 'original',
    proposalId: '01KZ41N2RPV012951SHW3G99KD',
    contractVersion: 2,
    engineFeatures: ['sequence'],
    messages: {
      bomberman_select_cards: 'ボンバーマン：捨てるカードを選んでください。',
    },
  },
  hooks: {
    afterPlay(context, play, input) {
      if (play.kind !== 'sequence') return [];

      const player = context.game.field.current?.by;
      if (!player) return [];

      const hand = context.game.players.find(
        (entry) => entry.id === player,
      )?.hand;
      const count = Math.min(1, hand?.length ?? 0);
      if (count === 0) return [];

      if (input?.kind === 'cards' && input.choiceId === CHOICE_ID) {
        return [
          {
            type: 'moveCards',
            from: { kind: 'hand', player },
            to: { kind: 'discard' },
            cards: { kind: 'specific', cardIds: [...input.cardIds] },
          },
        ];
      }

      return [
        {
          type: 'requestChoice',
          player,
          choiceId: CHOICE_ID,
          from: { kind: 'hand', player },
          cards: { kind: 'all' },
          count,
          messageKey: 'bomberman_select_cards',
        },
      ];
    },
  },
};
