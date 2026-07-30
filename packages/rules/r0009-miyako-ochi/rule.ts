import type { RuleModule } from '@daifugo/core';

const PREVIOUS_WINNER_KEY = 'previousWinner';

export const rule: RuleModule = {
  meta: {
    ruleId: 'r0009-miyako-ochi',
    name: '都落ち',
    description:
      '前ゲームの1位が次ゲームで最初に上がれなかった場合、そのプレイヤーを直ちに最下位として順位確定し、残りのプレイヤーでゲームを続ける。初回ゲームでは発動しない。',
    kind: 'local',
    proposalId: '01KYQNNS4EMFQTSKQVS7KN9DWN',
    contractVersion: 1,
    messages: {},
  },
  hooks: {
    afterPlay(context) {
      const actor = context.game.field.current?.by;
      const actorState = context.game.players.find(
        (player) => player.id === actor,
      );
      if (actorState?.standing !== 1) {
        return [];
      }

      const previousWinner = context.memory.set[PREVIOUS_WINNER_KEY];
      if (
        typeof previousWinner !== 'string' ||
        previousWinner === actor ||
        !context.game.players.some(
          (player) => player.id === previousWinner && player.standing === null,
        )
      ) {
        return [];
      }

      return [
        {
          type: 'forceRank',
          player: previousWinner,
          rank: 'lowest',
        },
      ];
    },
    onGameEnd(_context, standings) {
      const winner = standings.standings.find(
        (standing) => standing.standing === 1,
      );
      return winner
        ? [
            {
              type: 'setMemory',
              scope: 'set',
              key: PREVIOUS_WINNER_KEY,
              value: winner.player,
            },
          ]
        : [];
    },
  },
};
