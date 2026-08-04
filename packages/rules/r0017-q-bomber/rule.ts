import type { CardChoiceRequest, RuleModule } from '@daifugo/core';

const CHOICE_PREFIX = 'q_bomber_';

export const rule: RuleModule = {
  meta: {
    ruleId: 'r0017-q-bomber',
    name: 'Q-ボンバー',
    description:
      '自然なQを含む手を出すと、そのQの枚数分まで、全プレイヤーがそれぞれ自分の手札からカードを選び、選ばれたカードを捨て札へ移す。出した本人も対象に含む。',
    kind: 'local',
    prefecture: '東京都',
    proposalId: '01KZ1F7X5MRKH0T7ENDPGS0W6E',
    contractVersion: 2,
    messages: {
      q_bomber_choice: 'Q-ボンバーで捨てるカードを選んでください',
    },
  },
  hooks: {
    afterPlay(context, play, input) {
      const queenCount = play.cards.filter(
        (card) => card.kind === 'natural' && card.rank === 'Q',
      ).length;
      if (queenCount === 0) {
        return [];
      }

      if (input?.kind === 'cards') {
        const match = new RegExp(`^${CHOICE_PREFIX}([0-3])$`, 'u').exec(
          input.choiceId,
        );
        const player = match
          ? context.game.seats[Number.parseInt(match[1] ?? '', 10)]
          : undefined;
        if (!player) {
          return [];
        }
        return [
          {
            type: 'moveCards',
            from: { kind: 'hand', player },
            to: { kind: 'discard' },
            cards: { kind: 'specific', cardIds: [...input.cardIds] },
          },
        ];
      }

      const actor = context.game.field.current?.by;
      const orderedSeats = actor
        ? [actor, ...context.game.seats.filter((player) => player !== actor)]
        : [...context.game.seats];
      const choices: CardChoiceRequest[] = orderedSeats.flatMap((player) => {
        const hand = context.game.players.find(
          (candidate) => candidate.id === player,
        )?.hand;
        if (!hand || hand.length === 0) {
          return [];
        }
        const seatIndex = context.game.seats.indexOf(player);
        return [
          {
            player,
            choiceId: `${CHOICE_PREFIX}${String(seatIndex)}`,
            from: { kind: 'hand', player },
            cards: { kind: 'all' },
            count: Math.min(queenCount, hand.length),
            messageKey: 'q_bomber_choice',
          },
        ];
      });
      const [first, ...additionalChoices] = choices;
      return first
        ? [
            {
              type: 'requestChoice',
              ...first,
              additionalChoices,
              simultaneous: true,
            },
          ]
        : [];
    },
  },
};
