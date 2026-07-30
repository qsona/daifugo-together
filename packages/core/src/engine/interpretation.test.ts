import { describe, expect, it } from 'vitest';

import {
  createDeck,
  type Card,
  type CardRank,
  type JokerCard,
  type NaturalCard,
  type Suit,
} from '../cards/card.js';
import type { GameConfig, GameState, PlayerId } from '../game/types.js';
import type { Play, PlayKind } from '../play/play.js';
import type { PlayRank } from '../play/strength.js';
import { noRuleRuntime, type RuleRuntime } from '../rules/chain.js';
import type {
  EngineFeature,
  RuleChainEntry,
  RuleModule,
} from '../rules/contract.js';
import { createInProcessRuleChainPort } from '../rules/in-process.js';
import { seedRng } from '../rng/rng.js';
import { reduceGame } from './reducer.js';

const DECK = createDeck(['jokers']);
const seats = ['p1', 'p2', 'p3', 'p4'];

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

function fixtureEntry(
  ruleId: string,
  engineFeatures: EngineFeature[],
): RuleChainEntry {
  return {
    ruleId,
    name: ruleId,
    position: 0,
    priority: { score: 0, activatedAt: 0, ruleId },
    bundleHash: 'fixture',
    contractVersion: 1,
    engineFeatures,
  };
}

function makeConfig(engineFeatures: EngineFeature[]): GameConfig {
  return {
    gameIndex: 0,
    seats,
    gameSeed: 'interpretation',
    ruleChain: [fixtureEntry('r-test-features', engineFeatures)],
  };
}

function play(kind: PlayKind, cards: Card[], repRank: PlayRank): Play {
  return { kind, cards, count: cards.length, repRank };
}

function makeState(
  hand: Card[],
  field?: { play: Play; by: PlayerId },
): GameState {
  const fillers: Record<string, NaturalCard> = {
    p2: nat('club', 'J'),
    p3: nat('club', 'Q'),
    p4: nat('club', 'K'),
  };
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
      seats.map((id) => [
        id,
        {
          id,
          hand: id === 'p1' ? hand : [fillers[id]!],
          status: 'active' as const,
          skipCount: 0,
        },
      ]),
    ),
  };
}

function playAction(cards: Card[], kind?: PlayKind) {
  return {
    type: 'play' as const,
    player: 'p1',
    cards: cards.map((card) => card.id),
    ...(kind === undefined ? {} : { kind }),
  };
}

function fieldPlayOf(transition: ReturnType<typeof reduceGame>): Play {
  const current = transition.state.public.field.current;
  if (!current) {
    throw new Error('Expected a field play');
  }
  return current.play;
}

describe('joker single strength', () => {
  const config = makeConfig(['jokers']);

  it('JK 単騎は 2 より強い', () => {
    const state = makeState([joker(0), nat('spade', '4')], {
      play: play('single', [nat('heart', '2')], '2'),
      by: 'p2',
    });
    const transition = reduceGame(config, state, playAction([joker(0)]));
    expect(transition.rejections).toEqual([]);
    expect(fieldPlayOf(transition).repRank).toBe('joker');
  });

  it('JK 単騎に JK 単騎は TOO_WEAK、2 も出せない', () => {
    const fieldJoker = {
      play: play('single', [joker(0)], 'joker'),
      by: 'p2',
    };
    const jkOnJk = reduceGame(
      config,
      makeState([joker(1), nat('spade', '4')], fieldJoker),
      playAction([joker(1)]),
    );
    expect(jkOnJk.rejections).toEqual([{ player: 'p1', code: 'TOO_WEAK' }]);

    const twoOnJk = reduceGame(
      config,
      makeState([nat('spade', '2'), nat('spade', '4')], fieldJoker),
      playAction([nat('spade', '2')]),
    );
    expect(twoOnJk.rejections).toEqual([{ player: 'p1', code: 'TOO_WEAK' }]);
  });

  it('反転 (革命) 下でも JK 単騎は最強のまま', () => {
    const entry = fixtureEntry('r-test-revolution', ['jokers']);
    const revolution: RuleModule = {
      meta: {
        ruleId: entry.ruleId,
        name: entry.name,
        description: '常時反転',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
        engineFeatures: ['jokers'],
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
    const revConfig: GameConfig = { ...makeConfig([]), ruleChain: [entry] };
    // 反転下では 3 が最強の自然カード
    const state = makeState([joker(0), nat('spade', 'K')], {
      play: play('single', [nat('heart', '3')], '3'),
      by: 'p2',
    });
    const transition = reduceGame(
      revConfig,
      state,
      playAction([joker(0)]),
      runtime,
    );
    expect(transition.rejections).toEqual([]);
    expect(fieldPlayOf(transition).repRank).toBe('joker');
  });
});

describe('joker wildcard substitution', () => {
  const config = makeConfig(['sequence', 'jokers']);

  it('JK+7 のペアは 7 の実効ランクで場のペアに出せる', () => {
    const state = makeState([nat('spade', '7'), joker(0), nat('spade', '4')], {
      play: play('set', [nat('club', '5'), nat('heart', '5')], '5'),
      by: 'p2',
    });
    const transition = reduceGame(
      config,
      state,
      playAction([nat('spade', '7'), joker(0)]),
    );
    expect(transition.rejections).toEqual([]);
    expect(fieldPlayOf(transition)).toMatchObject({
      kind: 'set',
      count: 2,
      repRank: '7',
    });
  });

  it('JK2枚のペアは repRank joker の最強ペア', () => {
    const state = makeState([joker(0), joker(1), nat('spade', '4')], {
      play: play('set', [nat('club', '2'), nat('heart', '2')], '2'),
      by: 'p2',
    });
    const transition = reduceGame(
      config,
      state,
      playAction([joker(0), joker(1)]),
    );
    expect(transition.rejections).toEqual([]);
    expect(fieldPlayOf(transition)).toMatchObject({
      kind: 'set',
      count: 2,
      repRank: 'joker',
    });
  });

  it('sequence の端の代用: 上端を代用しても repRank は代用先ランク', () => {
    const state = makeState([nat('spade', '3'), nat('spade', '4'), joker(0)]);
    const transition = reduceGame(
      config,
      state,
      playAction([nat('spade', '3'), nat('spade', '4'), joker(0)]),
    );
    expect(transition.rejections).toEqual([]);
    expect(fieldPlayOf(transition)).toMatchObject({
      kind: 'sequence',
      count: 3,
      repRank: '5',
    });
  });

  it('sequence の中間の代用', () => {
    const state = makeState([nat('spade', '4'), nat('spade', '6'), joker(0)]);
    const transition = reduceGame(
      config,
      state,
      playAction([nat('spade', '4'), nat('spade', '6'), joker(0)]),
    );
    expect(transition.rejections).toEqual([]);
    expect(fieldPlayOf(transition)).toMatchObject({
      kind: 'sequence',
      count: 3,
      repRank: '6',
    });
  });

  it('手札の JK1 を選んでも解釈でき、場には選んだ実カードが出る', () => {
    const state = makeState([
      nat('spade', '4'),
      nat('spade', '5'),
      joker(0),
      joker(1),
    ]);
    const transition = reduceGame(
      config,
      state,
      playAction([nat('spade', '4'), nat('spade', '5'), joker(1)], 'sequence'),
    );
    expect(transition.rejections).toEqual([]);
    const cardIds = fieldPlayOf(transition).cards.map((card) => card.id);
    expect(cardIds).toContain('JK1');
    expect(cardIds).not.toContain('JK0');
    expect(transition.state.players.p1?.hand.map((card) => card.id)).toEqual([
      'JK0',
    ]);
  });

  it('あがり (最後の手) がワイルド代用でも通常どおり処理される', () => {
    const state = makeState([nat('spade', '4'), nat('spade', '5'), joker(0)]);
    const transition = reduceGame(
      config,
      state,
      playAction([nat('spade', '4'), nat('spade', '5'), joker(0)]),
    );
    expect(transition.rejections).toEqual([]);
    expect(transition.events).toContainEqual({
      type: 'playerFinished',
      player: 'p1',
      standing: 1,
      title: '大富豪',
    });
    expect(transition.state.players.p1?.status).toBe('finished');
  });
});

describe('joker rule prototype (afterPlay forceRank)', () => {
  it('最後の手にジョーカーを含めて上がると forceRank lowest が適用される', () => {
    const entry = fixtureEntry('r-proto-jokers', ['jokers']);
    const jokerRule: RuleModule = {
      meta: {
        ruleId: entry.ruleId,
        name: 'ジョーカー',
        description: 'ジョーカー含みあがりは最低順位',
        kind: 'local',
        proposalId: 'prototype',
        contractVersion: 1,
        messages: {},
        engineFeatures: ['jokers'],
      },
      hooks: {
        afterPlay(context, played) {
          if (!played.cards.some((card) => card.kind === 'joker')) {
            return [];
          }
          const by = context.game.field.current?.by;
          const remaining = context.game.players.find(
            (candidate) => candidate.id === by,
          )?.hand.length;
          return by !== undefined && remaining === 0
            ? [{ type: 'forceRank', player: by, rank: 'lowest' }]
            : [];
        },
      },
    };
    const runtime: RuleRuntime = {
      port: createInProcessRuleChainPort([jokerRule]),
      setHistory: [],
      setMemory: {},
    };
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'joker-finish',
      ruleChain: [entry],
    };
    const state = makeState([joker(0)]);
    const transition = reduceGame(
      config,
      state,
      playAction([joker(0)]),
      runtime,
    );
    expect(transition.rejections).toEqual([]);
    expect(transition.state.players.p1?.standing).toBe(4);
    expect(transition.state.public.firedRules).toContain(entry.ruleId);
  });
});

describe('moveCards against a sequence field', () => {
  it('sequence の場からの部分取り出しは incompatible として拒否され、場は壊れない', () => {
    const entry = fixtureEntry('r-test-field-steal', ['sequence']);
    const stealRule: RuleModule = {
      meta: {
        ruleId: entry.ruleId,
        name: '場抜き',
        description: '場から1枚抜く',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
        engineFeatures: ['sequence'],
      },
      hooks: {
        afterPlay(_context, played) {
          return played.kind === 'sequence'
            ? [
                {
                  type: 'moveCards',
                  from: { kind: 'field' },
                  to: { kind: 'discard' },
                  cards: {
                    kind: 'specific',
                    cardIds: [played.cards[0]!.id],
                  },
                },
              ]
            : [];
        },
      },
    };
    const runtime: RuleRuntime = {
      port: createInProcessRuleChainPort([stealRule]),
      setHistory: [],
      setMemory: {},
    };
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'field-steal',
      ruleChain: [entry],
    };
    const hand = [
      nat('spade', '3'),
      nat('spade', '4'),
      nat('spade', '5'),
      nat('spade', '9'),
    ];
    const transition = reduceGame(
      config,
      makeState(hand),
      playAction(hand.slice(0, 3)),
      runtime,
    );
    expect(transition.rejections).toEqual([]);
    expect(transition.state.public.field.current?.play).toMatchObject({
      kind: 'sequence',
      count: 3,
      repRank: '5',
    });
    expect(
      transition.state.public.field.current?.play.cards.map((card) => card.id),
    ).toEqual(['S03', 'S04', 'S05']);
    expect(transition.events).toContainEqual(
      expect.objectContaining({
        type: 'effectRejected',
        ruleId: entry.ruleId,
        detail: { applied: false, reason: 'incompatible-field-cards' },
      }),
    );
  });
});

describe('play interpretation and ambiguity', () => {
  const config = makeConfig(['sequence', 'jokers']);

  it('4-5-JK は JK=3 と JK=6 の 2 解釈から最弱 (3..5, repRank 5) を採用する', () => {
    const state = makeState([nat('spade', '4'), nat('spade', '5'), joker(0)]);
    const transition = reduceGame(
      config,
      state,
      playAction([nat('spade', '4'), nat('spade', '5'), joker(0)]),
    );
    expect(transition.rejections).toEqual([]);
    expect(fieldPlayOf(transition)).toMatchObject({
      kind: 'sequence',
      repRank: '5',
    });
  });

  it('kind 指定なしは最弱解釈 (kind 優先順 single<set<sequence のタイブレーク)', () => {
    // {7♠, JK0, JK1} は set (rep 7) とも 5-6-7 階段 (rep 7) とも解釈できる
    const state = makeState([nat('spade', '7'), joker(0), joker(1)]);
    const unspecified = reduceGame(
      config,
      state,
      playAction([nat('spade', '7'), joker(0), joker(1)]),
    );
    expect(unspecified.rejections).toEqual([]);
    expect(fieldPlayOf(unspecified)).toMatchObject({
      kind: 'set',
      repRank: '7',
    });
  });

  it('kind 指定で解釈が変わる (set / sequence)', () => {
    const hand = [nat('spade', '7'), joker(0), joker(1)];
    const asSet = reduceGame(config, makeState(hand), playAction(hand, 'set'));
    expect(fieldPlayOf(asSet)).toMatchObject({ kind: 'set', repRank: '7' });

    const asSequence = reduceGame(
      config,
      makeState(hand),
      playAction(hand, 'sequence'),
    );
    expect(fieldPlayOf(asSequence)).toMatchObject({
      kind: 'sequence',
      repRank: '7',
    });
  });

  it('7♠7♥JK は set としてのみ解釈され、sequence 指定はスート混在で不成立', () => {
    const hand = [nat('spade', '7'), nat('heart', '7'), joker(0)];
    const unspecified = reduceGame(config, makeState(hand), playAction(hand));
    expect(unspecified.rejections).toEqual([]);
    expect(fieldPlayOf(unspecified)).toMatchObject({
      kind: 'set',
      count: 3,
      repRank: '7',
    });

    const asSequence = reduceGame(
      config,
      makeState(hand),
      playAction(hand, 'sequence'),
    );
    expect(asSequence.rejections).toEqual([
      { player: 'p1', code: 'INVALID_PLAY_SHAPE' },
    ]);
  });

  it('engineFeatures 未宣言のチェーンでは 5 枚以上は INVALID_PLAY_SHAPE', () => {
    const plainConfig: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'plain',
      ruleChain: [],
    };
    const hand = [
      nat('spade', '3'),
      nat('spade', '4'),
      nat('spade', '5'),
      nat('spade', '6'),
      nat('spade', '7'),
    ];
    const transition = reduceGame(
      plainConfig,
      makeState(hand),
      playAction(hand),
      noRuleRuntime(),
    );
    expect(transition.rejections).toEqual([
      { player: 'p1', code: 'INVALID_PLAY_SHAPE' },
    ]);
  });
});
