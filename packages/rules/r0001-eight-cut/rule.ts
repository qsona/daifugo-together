import type { Effect, RuleModule } from '@daifugo/core';

export const rule: RuleModule = {
  meta: {
    ruleId: 'r0001-eight-cut',
    name: '8切り',
    description:
      '8を含む手を出すと場を流し、そのプレイヤーが次の場を開始する。ただし、その手で上がったプレイヤーは最低順位になる。',
    kind: 'local',
    proposalId: '01KYJGEX6BQAJ6V2M8P7Q3GEW5',
    contractVersion: 1,
    messages: {},
  },
  hooks: {
    afterPlay(context, play) {
      // 自然カードの8のみを見る: ジョーカーが8を代用しても8切りは発動しない。
      if (
        !play.cards.some((card) => card.kind === 'natural' && card.rank === '8')
      ) {
        return [];
      }

      const effects: Effect[] = [{ type: 'clearField' }];
      const player = context.game.field.current?.by;
      const remainingCards = context.game.players.find(
        (candidate) => candidate.id === player,
      )?.hand.length;

      if (player !== undefined && remainingCards === 0) {
        effects.push({ type: 'forceRank', player, rank: 'lowest' });
      }
      return effects;
    },
  },
};
