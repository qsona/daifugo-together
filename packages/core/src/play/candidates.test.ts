import { describe, expect, it } from 'vitest';

import {
  createDeck,
  type Card,
  type CardRank,
  type JokerCard,
  type NaturalCard,
  type Suit,
} from '../cards/card.js';
import type { GameConfig, GameState } from '../game/types.js';
import type { RuleChainEntry, RuleModule } from '../rules/contract.js';
import { createInProcessRuleChainPort } from '../rules/in-process.js';
import type { RuleRuntime } from '../rules/chain.js';
import { seedRng } from '../rng/rng.js';
import { evaluateCandidates, generateCandidates } from './candidates.js';
import { matchPlayCandidates, type Play } from './play.js';
import type { PlayRank } from './strength.js';

const DECK = createDeck(['jokers']);

function nat(suit: Suit, rank: CardRank): NaturalCard {
  const card = DECK.find(
    (candidate): candidate is NaturalCard =>
      candidate.kind === 'natural' &&
      candidate.suit === suit &&
      candidate.rank === rank,
  );
  if (!card) {
    throw new Error(`Missing card: ${suit} ${rank}`);
  }
  return card;
}

function joker(index: 0 | 1): JokerCard {
  const card = DECK.find(
    (candidate): candidate is JokerCard =>
      candidate.kind === 'joker' && candidate.index === index,
  );
  if (!card) {
    throw new Error(`Missing joker: ${index}`);
  }
  return card;
}

function sequences(candidates: Play[]): Play[] {
  return candidates.filter((play) => play.kind === 'sequence');
}

function idSet(play: Play): string {
  return play.cards
    .map((card) => card.id)
    .sort()
    .join(',');
}

const seats = ['p1', 'p2', 'p3', 'p4'];

function stateWithField(
  hand: Card[],
  field?: { play: Play; by: string },
): GameState {
  return {
    public: {
      phase: 'awaitingPlay',
      direction: 1,
      turn: 'p1',
      field: field
        ? { current: field, passedSinceLastPlay: [] }
        : { passedSinceLastPlay: [] },
      discard: [],
      standingsTaken: [],
      history: [],
      firedRules: [],
      turnCount: 0,
    },
    private: { excluded: [], memory: {}, rng: seedRng('test'), hookCalls: {} },
    players: Object.fromEntries(
      seats.map((id, index) => [
        id,
        {
          id,
          hand:
            id === 'p1'
              ? hand
              : [nat('club', ['3', '4', '5'][index - 1] as CardRank)],
          status: 'active' as const,
          skipCount: 0,
        },
      ]),
    ),
  };
}

function play(kind: Play['kind'], cards: Card[], repRank: PlayRank): Play {
  return { kind, cards, count: cards.length, repRank };
}

describe('sequence candidate generation', () => {
  it('同スート連続3枚以上を sequence として生成し、上端を repRank にする', () => {
    const hand = [nat('spade', '3'), nat('spade', '4'), nat('spade', '5')];
    const found = sequences(generateCandidates(hand, ['sequence']));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: 'sequence',
      count: 3,
      repRank: '5',
    });
  });

  it('スート混在・非連続・2枚は sequence にならない', () => {
    expect(
      sequences(
        generateCandidates(
          [nat('spade', '3'), nat('heart', '4'), nat('spade', '5')],
          ['sequence'],
        ),
      ),
    ).toHaveLength(0);
    expect(
      sequences(
        generateCandidates(
          [nat('spade', '3'), nat('spade', '5'), nat('spade', '7')],
          ['sequence'],
        ),
      ),
    ).toHaveLength(0);
    expect(
      sequences(
        generateCandidates(
          [nat('spade', '3'), nat('spade', '4')],
          ['sequence'],
        ),
      ),
    ).toHaveLength(0);
  });

  it('K-A-2 は有効で、2→3 のラップアラウンドは生成しない', () => {
    const kA2 = sequences(
      generateCandidates(
        [nat('spade', 'K'), nat('spade', 'A'), nat('spade', '2')],
        ['sequence'],
      ),
    );
    expect(kA2).toHaveLength(1);
    expect(kA2[0]?.repRank).toBe('2');

    const wrap = sequences(
      generateCandidates(
        [nat('spade', '2'), nat('spade', '3'), nat('spade', '4')],
        ['sequence'],
      ),
    );
    expect(wrap).toHaveLength(0);
  });

  it('engineFeatures 未指定では sequence を生成しない (従来生成器のみ)', () => {
    const hand = [nat('spade', '3'), nat('spade', '4'), nat('spade', '5')];
    const candidates = generateCandidates(hand);
    expect(sequences(candidates)).toHaveLength(0);
    expect(candidates.map((candidate) => candidate.kind)).toEqual([
      'single',
      'single',
      'single',
    ]);
  });
});

describe('joker candidate generation', () => {
  it('単体ジョーカーは repRank joker で、同一手のジョーカー単体は1候補に正規化される', () => {
    const candidates = generateCandidates(
      [nat('spade', '7'), joker(0), joker(1)],
      ['jokers'],
    );
    const jokerSingles = candidates.filter(
      (candidate) =>
        candidate.kind === 'single' && candidate.repRank === 'joker',
    );
    expect(jokerSingles).toHaveLength(1);
    expect(jokerSingles[0]?.cards[0]?.id).toBe('JK0');
  });

  it('set のワイルド代用は 2..4 枚で自然1枚以上、JK2枚のみのペアは repRank joker', () => {
    const candidates = generateCandidates(
      [nat('spade', '7'), nat('heart', '7'), joker(0), joker(1)],
      ['jokers'],
    );
    const sets = candidates.filter((candidate) => candidate.kind === 'set');
    expect(
      sets.some(
        (candidate) =>
          candidate.count === 2 &&
          candidate.repRank === '7' &&
          idSet(candidate) === 'JK0,S07',
      ),
    ).toBe(true);
    expect(
      sets.some(
        (candidate) =>
          candidate.count === 4 &&
          candidate.repRank === '7' &&
          idSet(candidate) === 'H07,JK0,JK1,S07',
      ),
    ).toBe(true);
    const jokerPair = sets.filter((candidate) => candidate.repRank === 'joker');
    expect(jokerPair).toHaveLength(1);
    expect(jokerPair[0]).toMatchObject({ count: 2 });
    // 5枚組は生成しない
    expect(sets.every((candidate) => candidate.count <= 4)).toBe(true);
    // 同一 (kind, count, repRank, 自然ID集合, JK枚数) は1候補
    const keys = sets.map(
      (candidate) =>
        `${candidate.count}|${candidate.repRank}|${idSet(candidate)}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('sequence のワイルド代用は自然1枚以上を要求し、上端代用でも代用先ランクが repRank になる', () => {
    const candidates = generateCandidates(
      [nat('spade', '3'), nat('spade', '4'), joker(0)],
      ['sequence', 'jokers'],
    );
    const found = sequences(candidates);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: 'sequence',
      count: 3,
      repRank: '5',
    });

    // ジョーカーのみでは sequence を作れない (自然0枚は不成立)
    const jokersOnly = sequences(
      generateCandidates([joker(0), joker(1)], ['sequence', 'jokers']),
    );
    expect(jokersOnly).toHaveLength(0);
  });

  it('sequence の中間を代用するJokerを論理位置に並べる', () => {
    const found = sequences(
      generateCandidates(
        [nat('spade', '4'), nat('spade', '6'), nat('spade', '7'), joker(0)],
        ['sequence', 'jokers'],
      ),
    ).find((play) => play.count === 4 && play.repRank === '7');

    expect(found?.cards.map((card) => card.id)).toEqual([
      'S04',
      'JK0',
      'S06',
      'S07',
    ]);
  });

  it('自然カードを持つ位置もジョーカーで代用した候補を併存列挙する', () => {
    const hand = [
      nat('spade', '3'),
      nat('spade', '4'),
      nat('spade', '5'),
      joker(0),
    ];
    const candidates = generateCandidates(hand, ['sequence', 'jokers']);

    // 3-JK-5 (4♠ を持っていても JK で代用できる)
    const middle = matchPlayCandidates(
      hand,
      [nat('spade', '3').id, nat('spade', '5').id, joker(0).id],
      candidates,
      'sequence',
    );
    expect(middle.ok).toBe(true);
    if (middle.ok) {
      expect(middle.matches[0]?.play).toMatchObject({
        kind: 'sequence',
        count: 3,
        repRank: '5',
      });
    }

    // 3-4-JK (JK=5 の上端代用。5♠ を持っていても選べる)
    const top = matchPlayCandidates(
      hand,
      [nat('spade', '3').id, nat('spade', '4').id, joker(0).id],
      candidates,
      'sequence',
    );
    expect(top.ok).toBe(true);
    if (top.ok) {
      expect(top.matches[0]?.play).toMatchObject({
        kind: 'sequence',
        count: 3,
        repRank: '5',
      });
    }

    // 重複除去キーが自然ID集合の違いを保持する (両候補が別々に存在する)
    const threeCardSequences = sequences(candidates).filter(
      (candidate) => candidate.count === 3 && candidate.repRank === '5',
    );
    expect(new Set(threeCardSequences.map(idSet)).size).toBe(
      threeCardSequences.length,
    );
  });

  it('14枚 (ジョーカー2枚込み) でも候補は 1000 未満に収まる', () => {
    const hand: Card[] = [
      ...(['3', '4', '5', '6', '7', '8'] as const).map((rank) =>
        nat('spade', rank),
      ),
      ...(['3', '4', '5', '6', '7', '8'] as const).map((rank) =>
        nat('heart', rank),
      ),
      joker(0),
      joker(1),
    ];
    const start = performance.now();
    const candidates = generateCandidates(hand, ['sequence', 'jokers']);
    const elapsed = performance.now() - start;
    expect(candidates.length).toBeLessThan(1000);
    expect(elapsed).toBeLessThan(200);
  });
});

describe('sequence legality against the field', () => {
  const config: GameConfig = {
    gameIndex: 0,
    seats,
    gameSeed: 'seq-legality',
    ruleChain: [],
  };

  function evaluateOn(field: Play | undefined, plays: Play[]) {
    const state = stateWithField(
      plays.flatMap((candidate) => candidate.cards),
      field ? { play: field, by: 'p2' } : undefined,
    );
    return evaluateCandidates(config, state, plays);
  }

  it('場が sequence なら同枚数で repRank がより強い sequence のみ出せる', () => {
    const field = play(
      'sequence',
      [nat('club', '4'), nat('club', '5'), nat('club', '6')],
      '6',
    );
    const stronger = play(
      'sequence',
      [nat('spade', '7'), nat('spade', '8'), nat('spade', '9')],
      '9',
    );
    const sameRank = play(
      'sequence',
      [nat('heart', '4'), nat('heart', '5'), nat('heart', '6')],
      '6',
    );
    const longer = play(
      'sequence',
      [
        nat('diamond', '7'),
        nat('diamond', '8'),
        nat('diamond', '9'),
        nat('diamond', '10'),
      ],
      '10',
    );
    const evaluated = evaluateOn(field, [stronger, sameRank, longer]);
    expect(evaluated.results).toEqual([
      { legal: true },
      { legal: false, reasonKey: 'TOO_WEAK' },
      { legal: false, reasonKey: 'TOO_WEAK' },
    ]);
  });

  it('sequence と single/set は互いに出せない', () => {
    const fieldSequence = play(
      'sequence',
      [nat('club', '4'), nat('club', '5'), nat('club', '6')],
      '6',
    );
    const set = play(
      'set',
      [nat('spade', 'K'), nat('heart', 'K'), nat('diamond', 'K')],
      'K',
    );
    const onSequence = evaluateOn(fieldSequence, [set]);
    expect(onSequence.results).toEqual([
      { legal: false, reasonKey: 'TOO_WEAK' },
    ]);

    const fieldSet = play(
      'set',
      [nat('club', '4'), nat('heart', '4'), nat('diamond', '4')],
      '4',
    );
    const sequence = play(
      'sequence',
      [nat('spade', '7'), nat('spade', '8'), nat('spade', '9')],
      '9',
    );
    const onSet = evaluateOn(fieldSet, [sequence]);
    expect(onSet.results).toEqual([{ legal: false, reasonKey: 'TOO_WEAK' }]);
  });

  it('革命 (modifyStrength 反転) 下では上端比較が「下端が強い」と同値になる', () => {
    const revolutionEntry: RuleChainEntry = {
      ruleId: 'r-test-revolution',
      name: '革命',
      position: 0,
      priority: { score: 0, activatedAt: 0, ruleId: 'r-test-revolution' },
      bundleHash: 'fixture',
      contractVersion: 1,
      engineFeatures: ['sequence'],
    };
    const revolution: RuleModule = {
      meta: {
        ruleId: revolutionEntry.ruleId,
        name: revolutionEntry.name,
        description: '常時反転',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
        engineFeatures: ['sequence'],
      },
      hooks: {
        modifyStrength: (_context, base) => ({
          ranking: [...base.ranking].reverse(),
        }),
      },
    };
    const runtime: RuleRuntime = {
      port: createInProcessRuleChainPort([revolution]),
      setHistory: [],
      setMemory: {},
    };
    const revConfig: GameConfig = { ...config, ruleChain: [revolutionEntry] };
    const field = play(
      'sequence',
      [nat('club', '8'), nat('club', '9'), nat('club', '10')],
      '10',
    );
    const low = play(
      'sequence',
      [nat('spade', '3'), nat('spade', '4'), nat('spade', '5')],
      '5',
    );
    const high = play(
      'sequence',
      [nat('spade', 'J'), nat('spade', 'Q'), nat('spade', 'K')],
      'K',
    );
    const state = stateWithField([...low.cards, ...high.cards], {
      play: field,
      by: 'p2',
    });
    const evaluated = evaluateCandidates(
      revConfig,
      state,
      [low, high],
      runtime,
    );
    // 下端同士 (3 vs 8) の反転比較でも低い列が強い、と同じ結果
    expect(evaluated.results).toEqual([
      { legal: true },
      { legal: false, reasonKey: 'TOO_WEAK' },
    ]);
  });
});

describe('comparison override legality against the field', () => {
  it('指定した3だけがジョーカーより強くなり、他ランクには波及しない', () => {
    const overrideEntry: RuleChainEntry = {
      ruleId: 'r-test-comparison-override',
      name: '比較例外',
      position: 0,
      priority: {
        score: 0,
        activatedAt: 0,
        ruleId: 'r-test-comparison-override',
      },
      bundleHash: 'fixture',
      contractVersion: 1,
      engineFeatures: ['jokers'],
    };
    const override: RuleModule = {
      meta: {
        ruleId: overrideEntry.ruleId,
        name: overrideEntry.name,
        description: '3をジョーカーより強くする',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
        engineFeatures: ['jokers'],
      },
      hooks: {
        modifyStrength: (_context, base) => ({
          ...base,
          comparisonOverrides: [
            ...(base.comparisonOverrides ?? []),
            { stronger: '3', weaker: 'joker' },
          ],
        }),
      },
    };
    const runtime: RuleRuntime = {
      port: createInProcessRuleChainPort([override]),
      setHistory: [],
      setMemory: {},
    };
    const field = play('single', [joker(0)], 'joker');
    const three = play('single', [nat('spade', '3')], '3');
    const four = play('single', [nat('spade', '4')], '4');
    const state = stateWithField([...three.cards, ...four.cards], {
      play: field,
      by: 'p2',
    });

    const evaluated = evaluateCandidates(
      {
        gameIndex: 0,
        seats,
        gameSeed: 'comparison-override',
        ruleChain: [overrideEntry],
      },
      state,
      [three, four],
      runtime,
    );

    expect(evaluated.results).toEqual([
      { legal: true },
      { legal: false, reasonKey: 'TOO_WEAK' },
    ]);
  });
});
