import type { RuleModule } from '@daifugo/core';

const ACTIVE_MEMORY_KEY = 'active';

export const rule: RuleModule = {
  meta: {
    ruleId: 'r0005-eleven-back',
    name: 'イレブンバック',
    description:
      'Jを含む手を出すと、場が流れるまでカードの強さ順が一時的に反転する。革命中は一時的に通常の強さ順へ戻り、場が流れると直前の強さ順へ戻る。あがり禁止の判定は変化しない。',
    kind: 'local',
    proposalId: '01KYQNNS2KCKN98TZE8TFV8DVW',
    contractVersion: 1,
    messages: {},
  },
  hooks: {
    modifyStrength(context, base) {
      if (context.memory.game[ACTIVE_MEMORY_KEY] !== true) {
        return base;
      }

      return {
        ranking: [...base.ranking].reverse(),
      };
    },
    afterPlay(_context, play) {
      const containsJack = play.cards.some(
        (card) => card.kind === 'natural' && card.rank === 'J',
      );

      if (!containsJack) {
        return [];
      }

      return [
        {
          type: 'setMemory',
          scope: 'game',
          key: ACTIVE_MEMORY_KEY,
          value: true,
        },
      ];
    },
    afterFieldClear() {
      return [
        {
          type: 'setMemory',
          scope: 'game',
          key: ACTIVE_MEMORY_KEY,
          value: false,
        },
      ];
    },
  },
};
