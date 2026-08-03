import {
  BASE_STRENGTH_ORDER,
  rankPosition,
  type Card,
  type RuleModule,
} from '@daifugo/core';

const TARGET_CHOICE = 'black_market_target';
const CARDS_PREFIX = 'black_market_cards_';

function strongestTwo(cards: readonly Card[]): string[] {
  return [...cards]
    .sort((left, right) => {
      const leftRank = left.kind === 'joker' ? 'joker' : left.rank;
      const rightRank = right.kind === 'joker' ? 'joker' : right.rank;
      const byStrength =
        rankPosition(rightRank, BASE_STRENGTH_ORDER) -
        rankPosition(leftRank, BASE_STRENGTH_ORDER);
      return byStrength !== 0 ? byStrength : left.id.localeCompare(right.id);
    })
    .slice(0, 2)
    .map(({ id }) => id);
}

export const rule: RuleModule = {
  meta: {
    ruleId: 'r0018-black-market',
    name: 'ブラックマーケット',
    description:
      '自然なAを3枚組で出すと、出したプレイヤーが交換相手1人と自分の残り手札2枚を選び、その2枚と相手の手札で自然な強さ順が最も強い2枚を同時に交換する。',
    kind: 'local',
    prefecture: '東京都',
    proposalId: '01KZ1FD5DANCDY208648PASMF0',
    contractVersion: 2,
    messages: {
      black_market_target: '交換する相手を選んでください',
      black_market_cards: '相手に渡すカードを2枚選んでください',
    },
  },
  hooks: {
    afterPlay(context, play, input) {
      const actor = context.game.field.current?.by;
      if (!actor) return [];
      const triggered =
        play.kind === 'set' &&
        play.cards.length === 3 &&
        play.cards.every(
          (card) => card.kind === 'natural' && card.rank === 'A',
        );
      if (!triggered) return [];

      if (input?.kind === 'cards') {
        const match = /^black_market_cards_([0-3])$/u.exec(input.choiceId);
        const target = match
          ? context.game.seats[Number.parseInt(match[1] ?? '', 10)]
          : undefined;
        const targetState = context.game.players.find(
          (player) => player.id === target,
        );
        if (
          !target ||
          target === actor ||
          targetState?.status !== 'active' ||
          targetState.hand.length < 2
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
            type: 'moveCards',
            from: { kind: 'hand', player: target },
            to: { kind: 'hand', player: actor },
            cards: {
              kind: 'specific',
              cardIds: strongestTwo(targetState.hand),
            },
          },
        ];
      }

      const actorState = context.game.players.find(
        (player) => player.id === actor,
      );
      if (!actorState || actorState.hand.length < 2) return [];

      const eligibleTargets = context.game.players
        .filter(
          (player) =>
            player.id !== actor &&
            player.status === 'active' &&
            player.hand.length >= 2,
        )
        .map(({ id }) => id);
      if (input?.kind === 'player' && input.choiceId === TARGET_CHOICE) {
        if (!eligibleTargets.includes(input.playerId)) return [];
        const targetIndex = context.game.seats.indexOf(input.playerId);
        return [
          {
            type: 'requestChoice',
            player: actor,
            choiceId: `${CARDS_PREFIX}${String(targetIndex)}`,
            from: { kind: 'hand', player: actor },
            cards: { kind: 'all' },
            count: 2,
            messageKey: 'black_market_cards',
          },
        ];
      }
      return eligibleTargets.length === 0
        ? []
        : [
            {
              type: 'requestChoice',
              player: actor,
              choiceId: TARGET_CHOICE,
              players: eligibleTargets,
              messageKey: 'black_market_target',
            },
          ];
    },
  },
};
