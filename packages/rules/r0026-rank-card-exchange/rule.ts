import type {
  Card,
  DeepReadonly,
  RuleContext,
  RuleModule,
  Standings,
} from '@daifugo/core';

const CHOICE_ID = 'exchange_card';
const WINNER_KEY = 'previousWinner';
const LOSER_KEY = 'previousLoser';

const NATURAL_STRENGTH = [
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'J',
  'Q',
  'K',
  'A',
  '2',
] as const;

function cardStrength(card: DeepReadonly<Card>): number {
  return card.kind === 'joker'
    ? NATURAL_STRENGTH.length
    : NATURAL_STRENGTH.indexOf(card.rank);
}

function strongestCard(cards: readonly DeepReadonly<Card>[]) {
  return [...cards].sort(
    (left, right) =>
      cardStrength(right) - cardStrength(left) ||
      left.id.localeCompare(right.id),
  )[0];
}

function rememberedPlayers(context: RuleContext) {
  const winner = context.memory.set[WINNER_KEY];
  const loser = context.memory.set[LOSER_KEY];
  return typeof winner === 'string' && typeof loser === 'string'
    ? { winner, loser }
    : null;
}

export const rule: RuleModule = {
  meta: {
    ruleId: 'r0026-rank-card-exchange',
    name: 'カード交換',
    description:
      '2ゲーム目以降の開始時、前ゲームの大富豪は自分の配られた手札から1枚を先に選び、そのカードと前ゲームの大貧民が持つ自然な強さ順で最も強い1枚を同時に交換する。',
    kind: 'local',
    proposalId: '01KZ1KGGYDTKDM9AN9W4NQ3YNS',
    contractVersion: 2,
    messages: {
      exchange_card_choice: '大貧民に渡すカードを1枚選んでください',
    },
  },
  hooks: {
    onGameEnd(_context, standings: DeepReadonly<Standings>) {
      const ordered = [...standings.standings].sort(
        (left, right) => left.standing - right.standing,
      );
      const winner = ordered[0];
      const loser = ordered.at(-1);
      return winner && loser
        ? [
            {
              type: 'setMemory',
              scope: 'set',
              key: WINNER_KEY,
              value: winner.player,
              silent: true,
            },
            {
              type: 'setMemory',
              scope: 'set',
              key: LOSER_KEY,
              value: loser.player,
              silent: true,
            },
          ]
        : [];
    },
    onGameStart(context, input) {
      const remembered = rememberedPlayers(context);
      if (!remembered || remembered.winner === remembered.loser) return [];
      const winner = context.game.players.find(
        ({ id, status }) => id === remembered.winner && status === 'active',
      );
      const loser = context.game.players.find(
        ({ id, status }) => id === remembered.loser && status === 'active',
      );
      if (!winner || !loser || winner.hand.length === 0) return [];

      if (input?.kind === 'cards' && input.choiceId === CHOICE_ID) {
        const selected = input.cardIds[0];
        const strongest = strongestCard(loser.hand);
        return selected && strongest
          ? [
              {
                type: 'moveCards',
                from: { kind: 'hand', player: winner.id },
                to: { kind: 'hand', player: loser.id },
                cards: { kind: 'specific', cardIds: [selected] },
              },
              {
                type: 'moveCards',
                from: { kind: 'hand', player: loser.id },
                to: { kind: 'hand', player: winner.id },
                cards: { kind: 'specific', cardIds: [strongest.id] },
              },
            ]
          : [];
      }

      return [
        {
          type: 'requestChoice',
          player: winner.id,
          choiceId: CHOICE_ID,
          from: { kind: 'hand', player: winner.id },
          cards: { kind: 'all' },
          count: 1,
          messageKey: 'exchange_card_choice',
        },
      ];
    },
  },
};
