import type {
  ChoiceRequestPayload,
  Effect,
  RuleContext,
  RuleModule,
} from '@daifugo/core';

const QUIZ_CHOICE_ID = 'binary_quiz';
const DISCARD_CHOICE_PREFIX = 'binary_quiz_discard:';

function discardChoiceId(player: string): string {
  return `${DISCARD_CHOICE_PREFIX}${player}`;
}

function discardEffectForInput(
  context: RuleContext,
  choiceId: string,
  cardIds: readonly string[],
): Effect[] {
  const player = context.game.players.find(
    ({ id }) => choiceId === discardChoiceId(id),
  );
  if (!player) return [];

  return [
    {
      type: 'moveCards',
      from: { kind: 'hand', player: player.id },
      to: { kind: 'discard' },
      cards: { kind: 'specific', cardIds: [...cardIds] },
    },
  ];
}

function discardChoicesForWinners(
  context: RuleContext,
  winnerPlayerIds: readonly string[],
): Effect[] {
  const winners = context.game.players.filter(
    ({ id, hand }) => winnerPlayerIds.includes(id) && hand.length > 0,
  );
  const choices: ChoiceRequestPayload[] = winners.map(({ id, hand }) => ({
    player: id,
    choiceId: discardChoiceId(id),
    from: { kind: 'hand', player: id },
    cards: { kind: 'all' },
    count: Math.min(3, hand.length),
    messageKey: 'binary_quiz_discard',
  }));
  const [first, ...additionalChoices] = choices;

  return first ? [{ type: 'requestChoice', ...first, additionalChoices }] : [];
}

function quizParticipants(context: RuleContext, playedBy: string): string[] {
  return context.game.seats.filter((playerId) => {
    const player = context.game.players.find(({ id }) => id === playerId);
    return playerId === playedBy || player?.status === 'active';
  });
}

export const rule: RuleModule = {
  meta: {
    ruleId: 'r0031-binary-quiz',
    name: '2択クイズ',
    description:
      '自然な2を1枚だけ出すと、出した人を含む退場していない全プレイヤーで二択クイズを行う。1問4秒で未回答はAとし、正解者全員に1点を与える。3点へ同じ問題で到達した全員を勝者とし、各勝者は手札から最大3枚を選んで捨てる。',
    kind: 'original',
    proposalId: '01KZG805WWSPYW8P0MBRGSRD8A',
    contractVersion: 2,
    messages: {
      binary_quiz_start: '二択クイズを開始します',
      binary_quiz_discard: '勝者は捨てるカードを選んでください',
    },
  },
  hooks: {
    afterPlay(context, play, input) {
      if (input?.kind === 'cards') {
        return discardEffectForInput(context, input.choiceId, input.cardIds);
      }
      if (
        input?.kind === 'miniGameMultiResult' &&
        input.choiceId === QUIZ_CHOICE_ID &&
        input.miniGameId === 'binary_quiz_race'
      ) {
        return discardChoicesForWinners(context, input.winnerPlayerIds);
      }
      if (input !== undefined) return [];

      const card = play.cards[0];
      if (
        play.count !== 1 ||
        play.cards.length !== 1 ||
        card?.kind !== 'natural' ||
        card.rank !== '2'
      ) {
        return [];
      }

      const playedBy = context.game.field.current?.by;
      if (!playedBy) return [];
      const participants = quizParticipants(context, playedBy);
      if (participants.length < 2) return [];

      return [
        {
          type: 'requestChoice',
          kind: 'miniGame',
          player: playedBy,
          choiceId: QUIZ_CHOICE_ID,
          miniGame: 'binary_quiz_race',
          participants,
          questionSet: 'general_v1',
          defaultOption: 'a',
          roundDurationMs: 4_000,
          targetScore: 3,
          maxRounds: 12,
          seed: `binary-quiz:${String(context.game.gameIndex)}:${String(
            context.rng.int(2_147_483_647),
          )}`,
          messageKey: 'binary_quiz_start',
        },
      ];
    },
  },
};
