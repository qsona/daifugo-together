import type { RuleModule } from '@daifugo/core';

const STARTING_GUN_RULE_ID = 'r0021-starting-gun';

export const rule: RuleModule = {
  meta: {
    ruleId: 'r0034-daifugo-no-yoyu',
    name: '大富豪の余裕',
    description:
      '2ゲーム目以降の開始時、前ゲームの大富豪がそのゲームで最初に迎える手番を1回飛ばす。ただし、号砲が適用されるゲームでは発動しない。',
    kind: 'local',
    proposalId: '01M079PQAM9D3EAN0201MF7J1G',
    contractVersion: 1,
    messages: {},
  },
  hooks: {
    onGameStart(context) {
      if (context.game.ruleIds.includes(STARTING_GUN_RULE_ID)) return [];

      const previousGame = context.setHistory.at(-1);
      const champion = previousGame?.standings.find(
        ({ standing }) => standing === 1,
      )?.player;
      return champion
        ? [{ type: 'skipTurns', player: champion, count: 1 }]
        : [];
    },
  },
};
