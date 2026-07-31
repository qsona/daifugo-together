import type { RuleModule } from '@daifugo/core';

const CHOICE_ID = 'ten_discard';

export const rule: RuleModule = {
  meta: {
    ruleId: 'r0010-ten-discard',
    name: '10捨て',
    description:
      '自然なランク10を含む手を出したプレイヤーは、その手に含まれる10の枚数と残り手札枚数の小さい方と同じ枚数のカードを、残り手札から必ず選んで捨て札へ移す。',
    kind: 'local',
    prefecture: '東京都',
    proposalId: '01KYSWRBH3YEVTAFC5NTR0TJ41',
    contractVersion: 2,
    messages: {
      ten_discard_choice: '10捨て: 捨てるカードを選んでください。',
    },
  },
  hooks: {
    afterPlay(context, play, input) {
      const actor = context.game.field.current?.by;
      if (!actor) {
        return [];
      }

      const tenCount = play.cards.filter(
        (card) => card.kind === 'natural' && card.rank === '10',
      ).length;
      if (tenCount === 0) {
        return [];
      }

      if (input !== undefined) {
        if (input.kind !== 'cards' || input.choiceId !== CHOICE_ID) {
          return [];
        }
        return [
          {
            type: 'moveCards',
            from: { kind: 'hand', player: actor },
            to: { kind: 'discard' },
            cards: {
              kind: 'specific',
              cardIds: [...input.cardIds],
            },
          },
        ];
      }

      const player = context.game.players.find(
        (candidate) => candidate.id === actor,
      );
      const count = Math.min(tenCount, player?.hand.length ?? 0);
      if (count === 0) {
        return [];
      }

      return [
        {
          type: 'requestChoice',
          player: actor,
          choiceId: CHOICE_ID,
          from: { kind: 'hand', player: actor },
          cards: { kind: 'all' },
          count,
          messageKey: 'ten_discard_choice',
        },
      ];
    },
  },
};
