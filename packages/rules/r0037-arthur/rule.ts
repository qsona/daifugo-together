import type {
  DeepReadonly,
  Play,
  RuleModule,
  StrengthOrder,
} from '@daifugo/core';

const ACTIVE_MEMORY_KEY = 'active';

function isActive(memory: DeepReadonly<Record<string, unknown>>): boolean {
  return memory[ACTIVE_MEMORY_KEY] === true;
}

function containsJoker(play: DeepReadonly<Play>): boolean {
  return play.cards.some((card) => card.kind === 'joker');
}

function disablesJokerSubstitution(play: DeepReadonly<Play>): boolean {
  if (!containsJoker(play) || play.kind === 'single') return false;
  return play.kind === 'sequence' || play.repRank !== 'joker';
}

function weakenJoker(base: DeepReadonly<StrengthOrder>): StrengthOrder {
  const ranking = [...base.ranking];
  const copiedBase: StrengthOrder = {
    ranking,
    ...(base.revolution === undefined ? {} : { revolution: base.revolution }),
    ...(base.comparisonOverrides === undefined
      ? {}
      : {
          comparisonOverrides: base.comparisonOverrides.map(
            ({ stronger, weaker }) => ({ stronger, weaker }),
          ),
        }),
  };
  const tenIndex = ranking.indexOf('10');
  const jackIndex = ranking.indexOf('J');
  if (tenIndex < 0 || jackIndex < 0) return copiedBase;

  const weakerBoundary = Math.min(tenIndex, jackIndex);
  const jokerComparisons = ranking.map((rank, index) =>
    index <= weakerBoundary
      ? ({ stronger: 'joker', weaker: rank } as const)
      : ({ stronger: rank, weaker: 'joker' } as const),
  );
  return {
    ...copiedBase,
    comparisonOverrides: [
      ...(copiedBase.comparisonOverrides ?? []),
      ...jokerComparisons,
    ],
  };
}

export const rule: RuleModule = {
  meta: {
    ruleId: 'r0037-arthur',
    name: 'アーサー',
    description:
      '自然なKをちょうど3枚含む合法な手を出すと、そのゲームの終了まで、ジョーカーは組や階段で他のカードを代用できなくなり、単体および比較時の強さが10とJの間になる。',
    kind: 'local',
    proposalId: '01M07A7RVPW1X8VEDR6NH056A5',
    contractVersion: 1,
    engineFeatures: ['jokers'],
    messages: {},
  },
  hooks: {
    modifyLegality(context, play, base) {
      return isActive(context.memory.game) && disablesJokerSubstitution(play)
        ? { legal: false }
        : base;
    },
    modifyStrength(context, base) {
      return isActive(context.memory.game) ? weakenJoker(base) : base;
    },
    afterPlay(context, play) {
      if (isActive(context.memory.game)) return [];
      const naturalKings = play.cards.filter(
        (card) => card.kind === 'natural' && card.rank === 'K',
      ).length;
      return naturalKings === 3
        ? [
            {
              type: 'setMemory',
              scope: 'game',
              key: ACTIVE_MEMORY_KEY,
              value: true,
            },
          ]
        : [];
    },
  },
};
