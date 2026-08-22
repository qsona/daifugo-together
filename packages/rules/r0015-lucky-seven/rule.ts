import type { CardId, RuleModule } from '@daifugo/core';

const CHOICE_ID = 'lucky_seven_choice';

function isValidSelection(
  cardIds: readonly CardId[],
  handIds: readonly CardId[],
  count: number,
): boolean {
  return (
    cardIds.length === count &&
    new Set(cardIds).size === count &&
    cardIds.every((cardId) => handIds.includes(cardId))
  );
}

export const rule: RuleModule = {
  meta: {
    ruleId: 'r0015-lucky-seven',
    name: 'ラッキー7',
    description:
      '自然なランク7を3枚以上同時に出したプレイヤーは、残り手札があれば1枚を必ず選び、捨て札へ移す。',
    kind: 'local',
    proposalId: '01KZ0F33DXRJFH9QB47SSJEB3D',
    contractVersion: 2,
    messages: {
      lucky_seven_choice: 'ラッキー7: 捨てるカードを選んでください。',
    },
  },
  hooks: {
    afterPlay(context, play, input) {
      const sevenCount = play.cards.filter(
        (card) => card.kind === 'natural' && card.rank === '7',
      ).length;
      const actor = context.game.field.current?.by;
      if (sevenCount < 3 || !actor) return [];

      const actorState = context.game.players.find(({ id }) => id === actor);
      if (!actorState) return [];
      const count = Math.min(1, actorState.hand.length);
      if (count === 0) return [];

      if (input) {
        if (
          input.kind !== 'cards' ||
          input.choiceId !== CHOICE_ID ||
          !isValidSelection(
            input.cardIds,
            actorState.hand.map(({ id }) => id),
            count,
          )
        ) {
          return [];
        }
        return [
          {
            type: 'moveCards',
            from: { kind: 'hand', player: actor },
            to: { kind: 'discard' },
            cards: { kind: 'specific', cardIds: [...input.cardIds] },
          },
        ];
      }

      return [
        {
          type: 'requestChoice',
          player: actor,
          choiceId: CHOICE_ID,
          from: { kind: 'hand', player: actor },
          cards: { kind: 'all' },
          count,
          messageKey: 'lucky_seven_choice',
        },
      ];
    },
  },
};
