import type { DeepReadonly, Play, RuleModule } from '@daifugo/core';

const PREVIOUS_SUITS_KEY = 'previousSuits';
const BINDING_SUITS_KEY = 'bindingSuits';
const SUITS = ['spade', 'heart', 'diamond', 'club'] as const;

function suitSignature(play: DeepReadonly<Play>): string {
  const counts = new Map(SUITS.map((suit) => [suit, 0]));
  for (const card of play.cards) {
    if (card.kind === 'natural') {
      counts.set(card.suit, (counts.get(card.suit) ?? 0) + 1);
    }
  }
  return SUITS.map((suit) => counts.get(suit) ?? 0).join(',');
}

export const rule: RuleModule = {
  meta: {
    ruleId: 'r0008-shibari-double-shibari',
    name: '縛り(しばり)・ダブル縛り',
    description:
      '同じ場で連続して出された手のスート構成が完全に一致した場合、場が流れるまで、そのスート構成と完全に一致する手だけを合法とする。場が流れると縛りを解除する。',
    kind: 'local',
    proposalId: '01KYQNNS40BN7CXGYDHZQCKQD3',
    contractVersion: 1,
    messages: {},
  },
  hooks: {
    modifyLegality(context, play, base) {
      const binding = context.memory.game[BINDING_SUITS_KEY];
      if (typeof binding !== 'string') {
        return base;
      }
      return suitSignature(play) === binding ? base : { legal: false };
    },
    afterPlay(context, play) {
      const current = suitSignature(play);
      const effects = [
        {
          type: 'setMemory' as const,
          scope: 'game' as const,
          key: PREVIOUS_SUITS_KEY,
          value: current,
        },
      ];

      if (context.memory.game[PREVIOUS_SUITS_KEY] === current) {
        effects.push({
          type: 'setMemory',
          scope: 'game',
          key: BINDING_SUITS_KEY,
          value: current,
        });
      }
      return effects;
    },
    afterFieldClear() {
      return [
        {
          type: 'setMemory',
          scope: 'game',
          key: PREVIOUS_SUITS_KEY,
          value: null,
        },
        {
          type: 'setMemory',
          scope: 'game',
          key: BINDING_SUITS_KEY,
          value: null,
        },
      ];
    },
  },
};
