import type { DeepReadonly, Play, RuleModule } from '@daifugo/core';

const PREVIOUS_SUITS_KEY = 'previousSuits';
const BINDING_SUITS_KEY = 'bindingSuits';
const SUITS = ['spade', 'heart', 'diamond', 'club'] as const;

type SuitCounts = [number, number, number, number];

function naturalSuitCounts(play: DeepReadonly<Play>): SuitCounts {
  const counts: SuitCounts = [0, 0, 0, 0];
  for (const card of play.cards) {
    if (card.kind === 'natural') {
      const index = SUITS.indexOf(card.suit);
      counts[index] = (counts[index] ?? 0) + 1;
    }
  }
  return counts;
}

function signature(counts: SuitCounts): string {
  return counts.join(',');
}

function containsJoker(play: DeepReadonly<Play>): boolean {
  return play.cards.some((card) => card.kind === 'joker');
}

function chooseMissingSuits(
  counts: SuitCounts,
  remaining: number,
  start: number,
  result: string[],
): void {
  if (remaining === 0) {
    result.push(signature(counts));
    return;
  }
  for (let index = start; index < SUITS.length; index += 1) {
    if ((counts[index] ?? 0) !== 0) continue;
    const next = [...counts] as SuitCounts;
    next[index] = 1;
    chooseMissingSuits(next, remaining - 1, index + 1, result);
  }
}

function suitOptions(play: DeepReadonly<Play>): string[] {
  const counts = naturalSuitCounts(play);
  const jokerCount = play.cards.filter((card) => card.kind === 'joker').length;
  if (jokerCount === 0) return [signature(counts)];

  if (play.kind === 'sequence') {
    const naturalSuitIndexes = counts
      .map((count, index) => (count > 0 ? index : -1))
      .filter((index) => index >= 0);
    if (naturalSuitIndexes.length > 1) return [];
    if (naturalSuitIndexes.length === 1) {
      const index = naturalSuitIndexes[0]!;
      counts[index] = (counts[index] ?? 0) + jokerCount;
      return [signature(counts)];
    }
    return SUITS.map((_, index) => {
      const option: SuitCounts = [0, 0, 0, 0];
      option[index] = jokerCount;
      return signature(option);
    });
  }

  const options: string[] = [];
  chooseMissingSuits(counts, jokerCount, 0, options);
  return options;
}

export const rule: RuleModule = {
  meta: {
    ruleId: 'r0008-shibari-double-shibari',
    name: '縛り(しばり)・ダブル縛り',
    description:
      '同じ場で連続して出されたJOKERを含まない手のスート構成が完全に一致した場合、場が流れるまで、そのスート構成と完全に一致する手だけを合法とする。JOKERを含む手は不足するスートを代用して既存の縛りを満たせるが、新しい縛りの成立判定には使わない。場が流れると縛りを解除する。',
    kind: 'local',
    proposalId: '01KYQNNS40BN7CXGYDHZQCKQD3',
    contractVersion: 1,
    messages: {},
  },
  hooks: {
    modifyLegality(context, play, base) {
      const binding = context.memory.game[BINDING_SUITS_KEY];
      if (typeof binding !== 'string') return base;
      return suitOptions(play).includes(binding) ? base : { legal: false };
    },
    afterPlay(context, play) {
      if (containsJoker(play)) {
        return [
          {
            type: 'setMemory',
            scope: 'game',
            key: PREVIOUS_SUITS_KEY,
            value: null,
          },
        ];
      }

      const current = signature(naturalSuitCounts(play));
      const effects = [
        {
          type: 'setMemory' as const,
          scope: 'game' as const,
          key: PREVIOUS_SUITS_KEY,
          value: current,
        },
      ];
      if (
        typeof context.memory.game[BINDING_SUITS_KEY] !== 'string' &&
        context.memory.game[PREVIOUS_SUITS_KEY] === current
      ) {
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
