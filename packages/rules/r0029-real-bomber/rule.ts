import type {
  CardChoiceRequest,
  Effect,
  RuleContext,
  RuleModule,
} from '@daifugo/core';

const MINI_GAME_CHOICE_ID = 'real_bomber_bomb_throw';
const DISCARD_CHOICE_PREFIX = 'real_bomber_discard_s';
const FIRED_MEMORY_KEY = 'fired';

function participants(context: RuleContext): string[] {
  return context.game.players
    .filter((player) => player.status === 'active' && player.hand.length > 0)
    .map((player) => player.id);
}

function discardRequest(
  context: RuleContext,
  player: string,
): CardChoiceRequest | null {
  const entry = context.game.players.find(
    (candidate) => candidate.id === player,
  );
  const count = Math.min(2, entry?.hand.length ?? 0);
  if (count === 0) return null;
  const seat = context.game.seats.indexOf(player);
  if (seat < 0) return null;
  return {
    player,
    choiceId: `${DISCARD_CHOICE_PREFIX}${String(seat)}`,
    from: { kind: 'hand', player },
    cards: { kind: 'all' },
    count,
    messageKey: 'real_bomber_discard',
  };
}

export const rule: RuleModule = {
  meta: {
    ruleId: 'r0029-real-bomber',
    name: 'リアルボンバー',
    description:
      '1セットで最初に自然な4を1枚で出したときだけ約17秒のボム投げミニゲームが始まり、勝者は手札を最大2枚捨てる。',
    kind: 'original',
    proposalId: '01KZ4JJ2KM3F2BTS237DPGM478',
    contractVersion: 2,
    messages: {
      real_bomber_start: 'リアルボンバー: ボムスロー15、スタート！',
      real_bomber_discard:
        'リアルボンバー勝利！ 捨てるカードを選んでください。',
      real_bomber_result: 'リアルボンバー: {winner}の勝ち！',
    },
  },
  hooks: {
    afterPlay(context, play, input): Effect[] {
      const isTrigger =
        play.kind === 'single' &&
        play.cards.length === 1 &&
        play.cards[0]?.kind === 'natural' &&
        play.cards[0].rank === '4';
      if (!isTrigger) return [];
      if (context.memory.set[FIRED_MEMORY_KEY] === true) return [];

      if (
        input?.kind === 'cards' &&
        input.choiceId.startsWith(DISCARD_CHOICE_PREFIX)
      ) {
        const seat = Number(input.choiceId.slice(DISCARD_CHOICE_PREFIX.length));
        const winner = context.game.seats[seat];
        if (!winner) return [];
        return [
          {
            type: 'moveCards',
            from: { kind: 'hand', player: winner },
            to: { kind: 'discard' },
            cards: { kind: 'specific', cardIds: [...input.cardIds] },
          },
          {
            type: 'announce',
            messageKey: 'real_bomber_result',
            params: { winner: `プレイヤー${String(seat + 1)}` },
          },
          {
            type: 'setMemory',
            scope: 'set',
            key: FIRED_MEMORY_KEY,
            value: true,
            silent: true,
          },
        ];
      }

      const activeParticipants = participants(context);
      if (input?.kind === 'miniGameResult') {
        if (
          input.choiceId !== MINI_GAME_CHOICE_ID ||
          !activeParticipants.includes(input.winnerPlayerId)
        ) {
          return [];
        }
        const request = discardRequest(context, input.winnerPlayerId);
        return request ? [{ type: 'requestChoice', ...request }] : [];
      }

      if (input !== undefined || activeParticipants.length === 0) return [];
      if (activeParticipants.length === 1) {
        const request = discardRequest(context, activeParticipants[0]!);
        return request ? [{ type: 'requestChoice', ...request }] : [];
      }
      return [
        {
          type: 'requestChoice',
          kind: 'miniGame',
          player: activeParticipants[0]!,
          choiceId: MINI_GAME_CHOICE_ID,
          miniGame: 'bomb_throw_15',
          participants: activeParticipants,
          durationMs: 12_000,
          seed: context.rng.int(2_147_483_647).toString(36),
          messageKey: 'real_bomber_start',
        },
      ];
    },
  },
};
