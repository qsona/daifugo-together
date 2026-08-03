import type {
  Card,
  DeepReadonly,
  Play,
  RuleContext,
  RuleModule,
} from '@daifugo/core';
import { compareRanks } from '@daifugo/core';

function includesSpadeThree(play: DeepReadonly<Play>): boolean {
  return play.cards.some(
    (card) =>
      card.kind === 'natural' && card.suit === 'spade' && card.rank === '3',
  );
}

function isSingleJoker(play: DeepReadonly<Play> | undefined): boolean {
  return (
    play?.kind === 'single' &&
    play.count === 1 &&
    play.cards.length === 1 &&
    play.cards[0]?.kind === 'joker'
  );
}

function previousPlayOnCurrentField(
  context: RuleContext,
): DeepReadonly<Play> | undefined {
  for (let index = context.game.history.length - 1; index >= 0; index -= 1) {
    const event = context.game.history[index];
    if (event?.type === 'fieldCleared') return undefined;
    if (event?.type === 'played') return event.play;
  }
  return undefined;
}

function titleHolder(
  context: RuleContext,
  title: '大富豪' | '大貧民',
): string | undefined {
  const previousGame = context.setHistory[context.setHistory.length - 1];
  return previousGame?.standings.find((result) => result.title === title)
    ?.player;
}

function playRank(card: DeepReadonly<Card>) {
  return card.kind === 'joker' ? 'joker' : card.rank;
}

function strongestCard(
  hand: readonly DeepReadonly<Card>[],
  context: RuleContext,
): DeepReadonly<Card> | undefined {
  const strength = {
    ranking: [...context.game.strength.ranking],
    ...(context.game.strength.revolution === undefined
      ? {}
      : { revolution: context.game.strength.revolution }),
    ...(context.game.strength.comparisonOverrides === undefined
      ? {}
      : {
          comparisonOverrides: context.game.strength.comparisonOverrides.map(
            ({ stronger, weaker }) => ({ stronger, weaker }),
          ),
        }),
  };
  return hand.reduce<DeepReadonly<Card> | undefined>((strongest, card) => {
    if (!strongest) return card;
    const comparison = compareRanks(
      playRank(card),
      playRank(strongest),
      strength,
    );
    if (comparison > 0) return card;
    if (comparison < 0) return strongest;
    return card.id < strongest.id ? card : strongest;
  }, undefined);
}

export const rule: RuleModule = {
  meta: {
    ruleId: 'r0028-poisoned-bun',
    name: '毒まんじゅう',
    description:
      '大貧民がスペード3を含む手を出した直後、ジョーカー返しでない場合に自動発動し、その時点の大富豪の手札から最も強いカード1枚を捨て札へ移して「毒まんじゅう」のカットインを表示する。',
    kind: 'original',
    proposalId: '01KZ4C5SSAPC6KTJ4NE9QWF26X',
    contractVersion: 1,
    messages: {
      activated: '毒まんじゅう！',
    },
  },
  hooks: {
    afterPlay(context, play) {
      const actor = context.game.field.current?.by;
      const daihinmin = titleHolder(context, '大貧民');
      const daifugo = titleHolder(context, '大富豪');
      if (
        !actor ||
        actor !== daihinmin ||
        !daifugo ||
        !includesSpadeThree(play) ||
        isSingleJoker(previousPlayOnCurrentField(context))
      ) {
        return [];
      }

      const daifugoPlayer = context.game.players.find(
        (player) => player.id === daifugo,
      );
      const target = strongestCard(daifugoPlayer?.hand ?? [], context);
      if (!target) return [];

      return [
        {
          type: 'moveCards',
          from: { kind: 'hand', player: daifugo },
          to: { kind: 'discard' },
          cards: { kind: 'specific', cardIds: [target.id] },
        },
        { type: 'announce', messageKey: 'activated' },
      ];
    },
  },
};
