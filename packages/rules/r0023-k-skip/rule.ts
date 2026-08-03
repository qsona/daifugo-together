import type { PlayerId, RuleModule } from '@daifugo/core';

export const rule: RuleModule = {
  meta: {
    ruleId: 'r0023-k-skip',
    name: 'K-Skip',
    description:
      '自然なランクKを含む手を出すと、その手に含まれるKの枚数と同じ人数分、現在の進行方向にいる後続プレイヤーの手番を飛ばす。',
    kind: 'local',
    proposalId: '01KZ1G09RABJ4QMRPSNZYMZF9N',
    contractVersion: 1,
    messages: {},
  },
  hooks: {
    afterPlay(context, play) {
      const skipCount = play.cards.filter(
        (card) => card.kind === 'natural' && card.rank === 'K',
      ).length;
      const actor = context.game.field.current?.by;
      const actorIndex = actor ? context.game.seats.indexOf(actor) : -1;
      if (skipCount === 0 || actorIndex < 0) {
        return [];
      }

      const active = new Set(
        context.game.players
          .filter((player) => player.status === 'active')
          .map((player) => player.id),
      );
      if (active.size === 0) {
        return [];
      }

      const counts = new Map<PlayerId, number>();
      let cursor = actorIndex;
      for (let skipped = 0; skipped < skipCount; skipped += 1) {
        let target: PlayerId | undefined;
        for (let offset = 1; offset <= context.game.seats.length; offset += 1) {
          const index =
            (cursor +
              offset * context.game.direction +
              context.game.seats.length * 2) %
            context.game.seats.length;
          const candidate = context.game.seats[index];
          if (candidate && active.has(candidate)) {
            target = candidate;
            cursor = index;
            break;
          }
        }
        if (!target) {
          break;
        }
        counts.set(target, (counts.get(target) ?? 0) + 1);
      }

      return [...counts].map(([player, count]) => ({
        type: 'skipTurns',
        player,
        count,
      }));
    },
  },
};
