import {
  BASE_STRENGTH_ORDER,
  type DeepReadonly,
  type RuleModule,
  type StrengthOrder,
} from '@daifugo/core';

const REVOLUTION_MEMORY_KEY = 'active';
const REVERSED_BASE_RANKING = [...BASE_STRENGTH_ORDER.ranking].reverse();

function isRevolutionStrength(order: DeepReadonly<StrengthOrder>): boolean {
  return (
    order.ranking.length === REVERSED_BASE_RANKING.length &&
    order.ranking.every((rank, index) => rank === REVERSED_BASE_RANKING[index])
  );
}

export const rule: RuleModule = {
  meta: {
    ruleId: 'r0003-kakumei',
    name: '革命',
    description:
      '同一ランクのカードを4枚以上まとめて出すたびに革命状態を切り替える。革命中はジョーカーを除くカードの強さを逆転し、革命中に3を含む最後の手で上がったプレイヤーを最低順位にする。',
    kind: 'local',
    proposalId: '01KYQNNS1K2PMF5DBBKAR0W729',
    contractVersion: 1,
    messages: {},
  },
  hooks: {
    onGameStart() {
      return [
        {
          type: 'setMemory',
          scope: 'game',
          key: REVOLUTION_MEMORY_KEY,
          value: false,
        },
      ];
    },

    modifyStrength(context, base) {
      if (context.memory.game[REVOLUTION_MEMORY_KEY] !== true) {
        return base;
      }
      return { ranking: [...base.ranking].reverse() };
    },

    afterPlay(context, play) {
      const effects = [];
      const triggersRevolution = play.kind === 'set' && play.count >= 4;

      if (triggersRevolution) {
        effects.push({
          type: 'setMemory' as const,
          scope: 'game' as const,
          key: REVOLUTION_MEMORY_KEY,
          value: context.memory.game[REVOLUTION_MEMORY_KEY] !== true,
        });
      }

      const player = context.game.field.current?.by;
      const playerFinished =
        player !== undefined &&
        context.game.players.some(
          (candidate) =>
            candidate.id === player && candidate.status === 'finished',
        );
      const containsThree = play.cards.some(
        (card) => card.kind === 'natural' && card.rank === '3',
      );

      if (
        player !== undefined &&
        playerFinished &&
        containsThree &&
        isRevolutionStrength(context.game.strength)
      ) {
        effects.push({
          type: 'forceRank' as const,
          player,
          rank: 'lowest' as const,
        });
      }

      return effects;
    },
  },
};
