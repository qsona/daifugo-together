import type { RuleModule } from '@daifugo/core';

const ELEVEN_BACK_RULE_ID = 'r0005-eleven-back';

export const rule: RuleModule = {
  meta: {
    ruleId: 'r0019-6-modoshi',
    name: '6戻し',
    description:
      'イレブンバックによる一時的な強さ反転中にランク6を含む手を出すと、その反転を解除し、強さ順を永続的な革命状態に対応する順序へ戻す。',
    kind: 'local',
    prefecture: '東京都',
    proposalId: '01KZ1FFN0PRM9V6DF8BQX2TWXE',
    contractVersion: 1,
    messages: {},
  },
  hooks: {
    modifyStrength(context, base) {
      let elevenBackSeen = false;
      let cancelled = false;

      for (const event of context.game.history) {
        if (event.type === 'fieldCleared') {
          elevenBackSeen = false;
          cancelled = false;
          continue;
        }

        if (
          event.type === 'ruleFired' &&
          event.ruleId === ELEVEN_BACK_RULE_ID
        ) {
          elevenBackSeen = true;
          cancelled = false;
          continue;
        }

        if (
          elevenBackSeen &&
          event.type === 'played' &&
          event.play.cards.some(
            (card) => card.kind === 'natural' && card.rank === '6',
          )
        ) {
          cancelled = true;
        }
      }

      return cancelled
        ? { ...base, ranking: [...base.ranking].reverse() }
        : base;
    },
  },
};
