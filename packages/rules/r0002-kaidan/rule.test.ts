import {
  createInProcessRuleChainPort,
  evaluateCandidates,
  generateCandidates,
  seedRng,
  type Card,
  type CardRank,
  type GameConfig,
  type GameState,
  type NaturalCard,
  type Play,
  type RuleChainEntry,
  type RuleModule,
  type RuleRuntime,
  type Suit,
} from '@daifugo/core';
import { describe, expect, it, vi } from 'vitest';

const { rule } = (await vi.importActual('./rule.js')) as { rule: RuleModule };

const card = (suit: Suit, rank: CardRank): NaturalCard => ({
  kind: 'natural',
  id: `${suit}-${rank}`,
  suit,
  rank,
});

const sequence = (...cards: NaturalCard[]): Play => ({
  kind: 'sequence',
  cards,
  count: cards.length,
  repRank: cards.at(-1)?.rank ?? '3',
});

const single = (cardValue: NaturalCard): Play => ({
  kind: 'single',
  cards: [cardValue],
  count: 1,
  repRank: cardValue.rank,
});

const set = (...cards: NaturalCard[]): Play => ({
  kind: 'set',
  cards,
  count: cards.length,
  repRank: cards[0]?.rank ?? '3',
});

function stateWithField(hand: Card[], field?: Play): GameState {
  return {
    public: {
      phase: 'awaitingPlay',
      direction: 1,
      turn: 'p1',
      field: field
        ? { current: { play: field, by: 'p2' }, passedSinceLastPlay: [] }
        : { passedSinceLastPlay: [] },
      discard: [],
      standingsTaken: [],
      history: [],
      firedRules: [],
      turnCount: 0,
    },
    private: {
      excluded: [],
      memory: {},
      rng: seedRng('kaidan-test'),
      hookCalls: {},
    },
    players: {
      p1: { id: 'p1', hand, status: 'active', skipCount: 0 },
      p2: {
        id: 'p2',
        hand: [card('club', '3')],
        status: 'active',
        skipCount: 0,
      },
      p3: {
        id: 'p3',
        hand: [card('club', '4')],
        status: 'active',
        skipCount: 0,
      },
      p4: {
        id: 'p4',
        hand: [card('club', '5')],
        status: 'active',
        skipCount: 0,
      },
    },
  };
}

const baseConfig: GameConfig = {
  gameIndex: 0,
  seats: ['p1', 'p2', 'p3', 'p4'],
  gameSeed: 'kaidan-test',
  ruleChain: [],
};

function evaluate(field: Play | undefined, candidates: Play[]) {
  return evaluateCandidates(
    baseConfig,
    stateWithField(
      candidates.flatMap((candidate) => candidate.cards),
      field,
    ),
    candidates,
  ).results;
}

describe('階段', () => {
  it('sequence engine featureだけを宣言し、場が空なら3枚以上の連番を生成する', () => {
    expect(rule.meta.engineFeatures).toEqual(['sequence']);
    expect(rule.hooks).toEqual({});

    const threeCards = generateCandidates(
      [card('heart', '4'), card('heart', '5'), card('heart', '6')],
      rule.meta.engineFeatures,
    ).filter((candidate) => candidate.kind === 'sequence');
    const fourCards = generateCandidates(
      [
        card('spade', '9'),
        card('spade', '10'),
        card('spade', 'J'),
        card('spade', 'Q'),
      ],
      rule.meta.engineFeatures,
    ).filter((candidate) => candidate.kind === 'sequence');

    expect(threeCards).toHaveLength(1);
    expect(fourCards.some((candidate) => candidate.count === 4)).toBe(true);
    expect(evaluate(undefined, [threeCards[0]!])).toEqual([{ legal: true }]);
  });

  it('異なるスートでも同枚数で上端が強い階段を出せる', () => {
    const field = sequence(
      card('heart', '4'),
      card('heart', '5'),
      card('heart', '6'),
    );
    const stronger = sequence(
      card('spade', '6'),
      card('spade', '7'),
      card('spade', '8'),
    );

    expect(evaluate(field, [stronger])).toEqual([{ legal: true }]);
  });

  it('3枚と4枚の階段は互いに重ねられない', () => {
    const three = sequence(
      card('heart', '4'),
      card('heart', '5'),
      card('heart', '6'),
    );
    const four = sequence(
      card('spade', '6'),
      card('spade', '7'),
      card('spade', '8'),
      card('spade', '9'),
    );

    expect(evaluate(three, [four])[0]?.legal).toBe(false);
    expect(evaluate(four, [three])[0]?.legal).toBe(false);
  });

  it('階段には単体や同一ランクの組を出せない', () => {
    const field = sequence(
      card('heart', '4'),
      card('heart', '5'),
      card('heart', '6'),
    );
    const candidateSingle = single(card('spade', '8'));
    const candidateSet = set(card('spade', '8'), card('heart', '8'));

    expect(evaluate(field, [candidateSingle, candidateSet])).toEqual([
      { legal: false, reasonKey: 'TOO_WEAK' },
      { legal: false, reasonKey: 'TOO_WEAK' },
    ]);
  });

  it('同じ枚数でも場と同じか弱い階段は出せない', () => {
    const field = sequence(
      card('heart', '6'),
      card('heart', '7'),
      card('heart', '8'),
    );
    const same = sequence(
      card('spade', '6'),
      card('spade', '7'),
      card('spade', '8'),
    );
    const weaker = sequence(
      card('diamond', '3'),
      card('diamond', '4'),
      card('diamond', '5'),
    );

    expect(
      evaluate(field, [same, weaker]).map((result) => result.legal),
    ).toEqual([false, false]);
  });

  it('非連番や2枚以下を階段として生成しない', () => {
    const nonConsecutive = generateCandidates(
      [card('heart', '4'), card('heart', '6'), card('heart', '8')],
      rule.meta.engineFeatures,
    );
    const twoCards = generateCandidates(
      [card('heart', '4'), card('heart', '5')],
      rule.meta.engineFeatures,
    );

    expect(
      nonConsecutive.some((candidate) => candidate.kind === 'sequence'),
    ).toBe(false);
    expect(twoCards.some((candidate) => candidate.kind === 'sequence')).toBe(
      false,
    );
  });

  it('革命中は低い側の階段を強く扱う', () => {
    const revolutionEntry: RuleChainEntry = {
      ruleId: 'r-test-revolution',
      name: '革命fixture',
      position: 0,
      priority: { score: 0, activatedAt: 0, ruleId: 'r-test-revolution' },
      bundleHash: 'fixture',
      contractVersion: 1,
    };
    const revolution: RuleModule = {
      meta: {
        ruleId: revolutionEntry.ruleId,
        name: revolutionEntry.name,
        description: 'fixture',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        modifyStrength: (_context, base) => ({
          ranking: [...base.ranking].reverse(),
          revolution: true,
        }),
      },
    };
    const runtime: RuleRuntime = {
      port: createInProcessRuleChainPort([revolution]),
      setHistory: [],
      setMemory: {},
    };
    const config: GameConfig = {
      ...baseConfig,
      ruleChain: [revolutionEntry],
    };
    const field = sequence(
      card('heart', '8'),
      card('heart', '9'),
      card('heart', '10'),
    );
    const lower = sequence(
      card('spade', '3'),
      card('spade', '4'),
      card('spade', '5'),
    );
    const higher = sequence(
      card('diamond', 'J'),
      card('diamond', 'Q'),
      card('diamond', 'K'),
    );

    const results = evaluateCandidates(
      config,
      stateWithField([...lower.cards, ...higher.cards], field),
      [lower, higher],
      runtime,
    ).results;

    expect(results.map((result) => result.legal)).toEqual([true, false]);
  });
});
