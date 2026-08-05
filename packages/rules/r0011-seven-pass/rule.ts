import type {
  Card,
  CardId,
  PlayerId,
  RuleContext,
  RuleModule,
} from '@daifugo/core';

const CHOICE_ID = 'seven_pass_choice';
const RECEIVED_MESSAGE_KEY = 'seven_pass_received';

const SUIT_MARKS = {
  spade: '♠',
  heart: '♥',
  diamond: '♦',
  club: '♣',
} as const;

function cardLabel(card: Card): string {
  return card.kind === 'natural'
    ? `${SUIT_MARKS[card.suit]}${card.rank}`
    : `ジョーカー${String(card.index + 1)}`;
}

function naturalSevenCount(
  play: Parameters<NonNullable<RuleModule['hooks']['afterPlay']>>[1],
): number {
  return play.cards.filter(
    (card) => card.kind === 'natural' && card.rank === '7',
  ).length;
}

function nextActivePlayer(
  context: RuleContext,
  actor: PlayerId,
): PlayerId | undefined {
  const actorIndex = context.game.seats.indexOf(actor);
  if (actorIndex < 0) return undefined;

  for (let offset = 1; offset < context.game.seats.length; offset += 1) {
    const index =
      (actorIndex +
        context.game.direction * offset +
        context.game.seats.length) %
      context.game.seats.length;
    const candidate = context.game.seats[index];
    if (
      candidate &&
      context.game.players.find(({ id }) => id === candidate)?.status ===
        'active'
    ) {
      return candidate;
    }
  }
  return undefined;
}

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
    ruleId: 'r0011-seven-pass',
    name: '7渡し',
    description:
      '自然なランク7を含む手を出したプレイヤーは、その手に含まれる7の枚数と残り手札枚数の小さい方と同じ枚数のカードを残り手札から必ず選び、現在の進行方向で次のプレイヤーへ渡す。',
    kind: 'local',
    proposalId: '01KYW5CDR00MKHZQ9WRE0KSJDN',
    contractVersion: 2,
    messages: {
      seven_pass_choice: '7渡し: 次の人に渡すカードを選んでください。',
      seven_pass_received: '7渡しで {cards} を受け取りました。',
    },
  },
  hooks: {
    afterPlay(context, play, input) {
      const sevenCount = naturalSevenCount(play);
      const actor = context.game.field.current?.by;
      if (sevenCount === 0 || !actor) return [];

      const actorState = context.game.players.find(({ id }) => id === actor);
      const target = nextActivePlayer(context, actor);
      if (!actorState || !target) return [];

      const count = Math.min(sevenCount, actorState.hand.length);
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
            to: { kind: 'hand', player: target },
            cards: { kind: 'specific', cardIds: [...input.cardIds] },
          },
          {
            type: 'announce',
            messageKey: RECEIVED_MESSAGE_KEY,
            params: {
              cards: actorState.hand
                .filter((card) => input.cardIds.includes(card.id))
                .map(cardLabel)
                .join('・'),
            },
            players: [target],
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
          messageKey: 'seven_pass_choice',
        },
      ];
    },
  },
};
