import { describe, expect, it } from 'vitest';

import { createDeck, type NaturalCard } from '../cards/card.js';
import { reduceGame } from '../engine/reducer.js';
import { startGame } from '../game/start-game.js';
import type { GameConfig, GameState } from '../game/types.js';
import { BASE_STRENGTH_ORDER } from '../play/strength.js';
import { seedRng } from '../rng/rng.js';
import type { RuleRuntime } from './chain.js';
import type { RuleChainEntry, RuleModule } from './contract.js';
import { createInProcessRuleChainPort } from './in-process.js';

const seats = ['p1', 'p2', 'p3', 'p4'];

function entry(ruleId: string): RuleChainEntry {
  return {
    ruleId,
    name: ruleId,
    position: 0,
    priority: {
      score: 0,
      activatedAt: Date.parse('2026-07-26T00:00:00.000Z'),
      ruleId,
    },
    bundleHash: 'fixture',
    contractVersion: 1,
  };
}

function runtime(module: RuleModule): RuleRuntime {
  return {
    port: createInProcessRuleChainPort([module]),
    setHistory: [],
    setMemory: {},
  };
}

function oneCardState(ruleChain: RuleChainEntry[]): {
  config: GameConfig;
  state: GameState;
} {
  const deck = createDeck();
  const cards = ['3', '4', '5', '6'].map((rank) => {
    const card = deck.find(
      (candidate) => candidate.kind === 'natural' && candidate.rank === rank,
    );
    if (!card) {
      throw new Error(`Missing ${rank}`);
    }
    return card;
  });
  return {
    config: {
      gameIndex: 0,
      seats,
      gameSeed: 'effect-finish',
      ruleChain,
    },
    state: {
      public: {
        phase: 'awaitingPlay',
        direction: 1,
        turn: 'p1',
        field: { passedSinceLastPlay: [] },
        discard: [],
        standingsTaken: [],
        history: [],
        firedRules: [],
        turnCount: 0,
      },
      private: {
        excluded: [],
        memory: {},
        rng: seedRng('effect-finish'),
        hookCalls: {},
      },
      players: Object.fromEntries(
        seats.map((id, index) => [
          id,
          {
            id,
            hand: [cards[index]!],
            status: 'active' as const,
            skipCount: 0,
          },
        ]),
      ),
    },
  };
}

describe('GE-04 effect pipeline and lifecycle hooks', () => {
  it('onGameStartでもmodifyStrength適用済みの実効順序を渡す', () => {
    const reverseEntry = entry('r-always-reverse');
    const observerEntry = {
      ...entry('r-start-strength-observer'),
      position: 1,
    };
    let observedStrength: string[] = [];
    const reverse: RuleModule = {
      meta: {
        ruleId: reverseEntry.ruleId,
        name: '常時反転',
        description: '強さを常に反転するfixture',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        modifyStrength: (_context, base) => ({
          ranking: [...base.ranking].reverse(),
        }),
      },
    };
    const observer: RuleModule = {
      meta: {
        ruleId: observerEntry.ruleId,
        name: '開始時強さobserver',
        description: 'onGameStartが実効強さを読めることを確認するfixture',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        onGameStart: (context) => {
          observedStrength = [...context.game.strength.ranking];
          return [];
        },
      },
    };
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'start-hook-strength',
      ruleChain: [reverseEntry, observerEntry],
    };
    const strengthRuntime: RuleRuntime = {
      port: createInProcessRuleChainPort([reverse, observer]),
      setHistory: [],
      setMemory: {},
    };

    startGame(config, strengthRuntime);

    expect(observedStrength).toEqual(
      [...BASE_STRENGTH_ORDER.ranking].reverse(),
    );
  });

  it('afterPlayへプレイ直前の実効StrengthOrderを全ルール共通で渡す', () => {
    const revolutionEntry = entry('r-revolution');
    const observerEntry = { ...entry('r-strength-observer'), position: 1 };
    let observedStrength: {
      ranking: string[];
      revolution: boolean | undefined;
    } = { ranking: [], revolution: undefined };
    const revolution: RuleModule = {
      meta: {
        ruleId: revolutionEntry.ruleId,
        name: '革命',
        description: 'ゲーム内メモリから強さを反転するfixture',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        onGameStart: () => [
          {
            type: 'setMemory',
            scope: 'game',
            key: 'active',
            value: true,
          },
        ],
        modifyStrength: (context, base) =>
          context.memory.game.active === true
            ? {
                ranking: [...base.ranking].reverse(),
                revolution: !base.revolution,
              }
            : base,
      },
    };
    const observer: RuleModule = {
      meta: {
        ruleId: observerEntry.ruleId,
        name: '実効強さobserver',
        description: 'Effectフックが実効強さを読めることを確認するfixture',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        afterPlay: (context) => {
          observedStrength = {
            ranking: [...context.game.strength.ranking],
            revolution: context.game.strength.revolution,
          };
          return [];
        },
      },
    };
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'effect-hook-strength',
      ruleChain: [revolutionEntry, observerEntry],
    };
    const strengthRuntime: RuleRuntime = {
      port: createInProcessRuleChainPort([revolution, observer]),
      setHistory: [],
      setMemory: {},
    };

    const started = startGame(config, strengthRuntime);
    const player = started.state.public.turn;
    const card = player ? started.state.players[player]?.hand[0] : undefined;
    if (!player || !card) {
      throw new Error('Expected opening play');
    }

    const transition = reduceGame(
      config,
      started.state,
      { type: 'play', player, cards: [card.id] },
      strengthRuntime,
    );

    expect(transition.rejections).toEqual([]);
    expect(observedStrength).toEqual({
      ranking: [...BASE_STRENGTH_ORDER.ranking].reverse(),
      revolution: true,
    });
  });

  it('一時的な強さ反転は革命シグナルを変更しない', () => {
    const temporaryEntry = entry('r-temporary-reverse');
    const observerEntry = { ...entry('r-revolution-observer'), position: 1 };
    let observed:
      { ranking: string[]; revolution: boolean | undefined } | undefined;
    const temporary: RuleModule = {
      meta: {
        ruleId: temporaryEntry.ruleId,
        name: '一時反転',
        description: 'ランキングだけを反転するfixture',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        modifyStrength: (_context, base) => ({
          ranking: [...base.ranking].reverse(),
        }),
      },
    };
    const observer: RuleModule = {
      meta: {
        ruleId: observerEntry.ruleId,
        name: '革命シグナルobserver',
        description: '一時反転と革命を区別するfixture',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        onGameStart: (context) => {
          observed = {
            ranking: [...context.game.strength.ranking],
            revolution: context.game.strength.revolution,
          };
          return [];
        },
      },
    };
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'temporary-strength-signal',
      ruleChain: [temporaryEntry, observerEntry],
    };

    startGame(config, {
      port: createInProcessRuleChainPort([temporary, observer]),
      setHistory: [],
      setMemory: {},
    });

    expect(observed).toEqual({
      ranking: [...BASE_STRENGTH_ORDER.ranking].reverse(),
      revolution: undefined,
    });
  });

  it('announceなしで採用されたEffectもルール名fallback用の発動eventを出す', () => {
    const ruleEntry = entry('r0097-name-only');
    const module: RuleModule = {
      meta: {
        ruleId: ruleEntry.ruleId,
        name: '名前だけ演出',
        description: 'announceを返さないfixture',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        afterPlay: () => [{ type: 'reverseTurnOrder' }],
      },
    };
    const fixture = oneCardState([ruleEntry]);

    const transition = reduceGame(
      fixture.config,
      fixture.state,
      {
        type: 'play',
        player: 'p1',
        cards: [fixture.state.players.p1!.hand[0]!.id],
      },
      runtime(module),
    );

    expect(transition.events).toContainEqual({
      type: 'ruleFired',
      ruleId: ruleEntry.ruleId,
      messageKey: null,
    });
  });

  it('変換とafterPlay Effectを同じ発火ボレーで重複排除し優先度順に並べる', () => {
    const effectEntry = entry('r0095-effect-first');
    const transformEntry = {
      ...entry('r0096-transform-second'),
      position: 1,
    };
    const effectRule: RuleModule = {
      meta: {
        ruleId: effectEntry.ruleId,
        name: 'Effect優先',
        description: '優先度の高いEffect',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: { fired: 'Effect優先が発動' },
      },
      hooks: {
        afterPlay: () => [
          { type: 'reverseTurnOrder' },
          { type: 'announce', messageKey: 'fired' },
        ],
      },
    };
    const transformRule: RuleModule = {
      meta: {
        ruleId: transformEntry.ruleId,
        name: '変換は後',
        description: '優先度の低い変換',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        modifyLegality: () => ({ legal: true }),
      },
    };
    const fixture = oneCardState([effectEntry, transformEntry]);
    const fieldCard = createDeck().find(
      (card): card is NaturalCard =>
        card.kind === 'natural' && card.rank === '10',
    )!;
    const state: GameState = {
      ...fixture.state,
      public: {
        ...fixture.state.public,
        field: {
          current: {
            play: {
              kind: 'single',
              cards: [fieldCard],
              count: 1,
              repRank: fieldCard.rank,
            },
            by: 'p2',
          },
          passedSinceLastPlay: [],
        },
      },
    };
    const transition = reduceGame(
      fixture.config,
      state,
      {
        type: 'play',
        player: 'p1',
        cards: [state.players.p1!.hand[0]!.id],
      },
      {
        port: createInProcessRuleChainPort([effectRule, transformRule]),
        setHistory: [],
        setMemory: {},
      },
    );

    expect(
      transition.events
        .filter((event) => event.type === 'ruleFired')
        .map((event) => [event.ruleId, event.messageKey]),
    ).toEqual([
      [effectEntry.ruleId, 'fired'],
      [transformEntry.ruleId, null],
    ]);
  });

  it('leadNoLegalMove failsafeで破棄した変換は発火にも集計にも含めない', () => {
    const ruleEntry = entry('r0094-failsafe-transform');
    const module: RuleModule = {
      meta: {
        ruleId: ruleEntry.ruleId,
        name: '全部禁止',
        description: 'leadをすべて禁止してfailsafeになる',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        modifyLegality: () => ({
          legal: false,
          reasonKey: 'fixture.forbidden',
        }),
      },
    };
    const fixture = oneCardState([ruleEntry]);
    const transition = reduceGame(
      fixture.config,
      fixture.state,
      {
        type: 'play',
        player: 'p1',
        cards: [fixture.state.players.p1!.hand[0]!.id],
      },
      runtime(module),
    );

    expect(transition.events).toContainEqual({
      type: 'failsafe',
      reason: 'leadNoLegalMove',
      relatedRuleIds: [ruleEntry.ruleId],
    });
    expect(
      transition.events.some(
        (event) =>
          event.type === 'ruleFired' && event.ruleId === ruleEntry.ruleId,
      ),
    ).toBe(false);
    expect(transition.state.public.firedRules).not.toContain(ruleEntry.ruleId);
  });

  it('不正Effectを返したルールは同じ遷移内の後続hookからも除外する', () => {
    const invalidEntry = entry('r0098-invalid-same-transition');
    const finisherEntry = {
      ...entry('r0099-finisher'),
      position: 1,
    };
    let invalidEndCalls = 0;
    let finisherEndCalls = 0;
    const invalid: RuleModule = {
      meta: {
        ruleId: invalidEntry.ruleId,
        name: invalidEntry.name,
        description: 'invalid same-transition fixture',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        onGameStart: () => [
          {
            type: 'setMemory',
            scope: 'set',
            key: 'too-large',
            value: 'x'.repeat(2_000),
          },
        ],
        onGameEnd: () => {
          invalidEndCalls += 1;
          return [];
        },
      },
    };
    const finisher: RuleModule = {
      meta: {
        ruleId: finisherEntry.ruleId,
        name: finisherEntry.name,
        description: 'finisher fixture',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        onGameStart: (context) =>
          context.game.seats.slice(0, 3).map((player, index) => ({
            type: 'forceRank' as const,
            player,
            rank: (index + 1) as 1 | 2 | 3,
          })),
        onGameEnd: () => {
          finisherEndCalls += 1;
          return [];
        },
      },
    };
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'invalid-same-transition',
      ruleChain: [invalidEntry, finisherEntry],
    };
    const transition = startGame(config, {
      port: createInProcessRuleChainPort([invalid, finisher]),
      setHistory: [],
      setMemory: {},
    });

    expect(transition.state.public.phase).toBe('finished');
    expect(transition.events).toContainEqual(
      expect.objectContaining({
        type: 'effectRejected',
        ruleId: invalidEntry.ruleId,
        resolution: 'rejected',
      }),
    );
    expect(invalidEndCalls).toBe(0);
    expect(finisherEndCalls).toBe(1);
  });

  it('onGameStart・afterPlay・afterFieldClear・onGameEndを正規位置で呼ぶ', () => {
    const ruleEntry = entry('r0100-lifecycle');
    const calls: string[] = [];
    const lifecycle: RuleModule = {
      meta: {
        ruleId: ruleEntry.ruleId,
        name: ruleEntry.name,
        description: 'lifecycle probe',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        onGameStart: () => {
          calls.push('onGameStart');
          return [];
        },
        afterPlay: () => {
          calls.push('afterPlay');
          return [];
        },
        afterFieldClear: () => {
          calls.push('afterFieldClear');
          return [];
        },
        onGameEnd: () => {
          calls.push('onGameEnd');
          return [];
        },
      },
    };
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'lifecycle',
      ruleChain: [ruleEntry],
    };
    const ruleRuntime = runtime(lifecycle);
    const started = startGame(config, ruleRuntime);
    expect(calls).toEqual(['onGameStart']);

    const player = started.state.public.turn;
    const card = player ? started.state.players[player]?.hand[0] : undefined;
    if (!player || !card) {
      throw new Error('Expected opening play');
    }
    let transition = reduceGame(
      config,
      started.state,
      { type: 'play', player, cards: [card.id] },
      ruleRuntime,
    );
    expect(calls).toContain('afterPlay');
    const passers = seats.filter((id) => id !== player);
    for (const passer of passers) {
      transition = reduceGame(
        config,
        transition.state,
        { type: 'pass', player: passer },
        ruleRuntime,
      );
    }
    expect(calls).toContain('afterFieldClear');

    const ending = oneCardState([ruleEntry]);
    let endingTransition = reduceGame(
      ending.config,
      ending.state,
      {
        type: 'play',
        player: 'p1',
        cards: [ending.state.players.p1!.hand[0]!.id],
      },
      ruleRuntime,
    );
    endingTransition = reduceGame(
      ending.config,
      endingTransition.state,
      {
        type: 'play',
        player: 'p2',
        cards: [endingTransition.state.players.p2!.hand[0]!.id],
      },
      ruleRuntime,
    );
    endingTransition = reduceGame(
      ending.config,
      endingTransition.state,
      {
        type: 'play',
        player: 'p3',
        cards: [endingTransition.state.players.p3!.hand[0]!.id],
      },
      ruleRuntime,
    );
    expect(endingTransition.state.public.phase).toBe('finished');
    expect(calls.at(-1)).toBe('onGameEnd');
  });

  it('Effectを優先度解決後に適用し、詳細ログは公開履歴へ混ぜない', () => {
    const ruleEntry = entry('r0101-effects');
    const module: RuleModule = {
      meta: {
        ruleId: ruleEntry.ruleId,
        name: ruleEntry.name,
        description: 'effect application',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        afterPlay: () => [
          { type: 'reverseTurnOrder' },
          { type: 'skipTurns', player: 'p2', count: 9 },
          {
            type: 'setMemory',
            scope: 'game',
            key: 'activated',
            value: true,
          },
          { type: 'announce', messageKey: 'activated' },
        ],
      },
    };
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'effect-application',
      ruleChain: [ruleEntry],
    };
    const started = startGame(config).state;
    const player = started.public.turn;
    const card = player ? started.players[player]?.hand[0] : undefined;
    if (!player || !card) {
      throw new Error('Expected opening play');
    }
    const transition = reduceGame(
      config,
      started,
      { type: 'play', player, cards: [card.id] },
      runtime(module),
    );

    expect(transition.state.public.direction).toBe(-1);
    expect(transition.state.players.p2?.skipCount).toBeLessThanOrEqual(3);
    expect(transition.state.private.memory[ruleEntry.ruleId]?.activated).toBe(
      true,
    );
    expect(transition.state.public.firedRules).toContain(ruleEntry.ruleId);
    expect(
      transition.events.filter((event) => event.type === 'effectApplied'),
    ).toHaveLength(4);
    expect(
      transition.state.public.history.some(
        (event) =>
          (event.type as string) === 'effectApplied' ||
          (event.type as string) === 'effectRejected',
      ),
    ).toBe(false);
  });

  it('forceRankで退場・非公開カード隔離・近傍順位割当を行う', () => {
    const ruleEntry = entry('r0102-force-rank');
    const module: RuleModule = {
      meta: {
        ruleId: ruleEntry.ruleId,
        name: ruleEntry.name,
        description: 'force rank',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        afterPlay: () => [{ type: 'forceRank', player: 'p2', rank: 4 }],
      },
    };
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'force-rank',
      ruleChain: [ruleEntry],
    };
    const started = startGame(config).state;
    const player = started.public.turn;
    const card = player ? started.players[player]?.hand[0] : undefined;
    if (!player || !card) {
      throw new Error('Expected opening play');
    }
    const p2Cards = started.players.p2?.hand.length ?? 0;
    const transition = reduceGame(
      config,
      started,
      { type: 'play', player, cards: [card.id] },
      runtime(module),
    );

    expect(transition.state.players.p2).toMatchObject({
      status: 'retired',
      standing: 4,
      hand: [],
    });
    expect(transition.state.private.excluded).toHaveLength(p2Cards);
    expect(transition.events).toContainEqual({
      type: 'playerRetired',
      player: 'p2',
      cardCount: p2Cards,
      standing: 4,
    });
    const allCards = [
      ...Object.values(transition.state.players).flatMap(
        (candidate) => candidate.hand,
      ),
      ...(transition.state.public.field.current?.play.cards ?? []),
      ...transition.state.public.discard,
      ...transition.state.private.excluded,
    ];
    expect(allCards).toHaveLength(52);
    expect(new Set(allCards.map((candidate) => candidate.id))).toHaveLength(52);
  });

  it('同じ希望順位が埋まっている場合は下位側から近傍の空きへ割り当てる', () => {
    const ruleEntry = entry('r0104-force-rank-nearest');
    const module: RuleModule = {
      meta: {
        ruleId: ruleEntry.ruleId,
        name: ruleEntry.name,
        description: 'force rank nearest slot',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        afterPlay: () => [
          { type: 'forceRank', player: 'p2', rank: 4 },
          { type: 'forceRank', player: 'p3', rank: 4 },
        ],
      },
    };
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'force-rank-nearest',
      ruleChain: [ruleEntry],
    };
    const started = startGame(config).state;
    const player = started.public.turn;
    const card = player ? started.players[player]?.hand[0] : undefined;
    if (!player || !card) {
      throw new Error('Expected opening play');
    }

    const transition = reduceGame(
      config,
      started,
      { type: 'play', player, cards: [card.id] },
      runtime(module),
    );

    expect(transition.state.players.p2?.standing).toBe(4);
    expect(transition.state.players.p3?.standing).toBe(3);
  });

  it("forceRankのrank:'lowest'は4人ゲームで最下位(4位)に解決される", () => {
    const ruleEntry = entry('r0106-force-rank-lowest');
    const module: RuleModule = {
      meta: {
        ruleId: ruleEntry.ruleId,
        name: ruleEntry.name,
        description: 'force rank lowest',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        afterPlay: () => [{ type: 'forceRank', player: 'p2', rank: 'lowest' }],
      },
    };
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'force-rank-lowest',
      ruleChain: [ruleEntry],
    };
    const started = startGame(config).state;
    const player = started.public.turn;
    const card = player ? started.players[player]?.hand[0] : undefined;
    if (!player || !card) {
      throw new Error('Expected opening play');
    }
    const transition = reduceGame(
      config,
      started,
      { type: 'play', player, cards: [card.id] },
      runtime(module),
    );

    expect(transition.state.players.p2).toMatchObject({
      status: 'retired',
      standing: 4,
    });
  });

  it("別々のフック発火で順に'lowest'対象になった場合、先着がより低い順位になる", () => {
    const ruleEntry = entry('r0107-force-rank-lowest-sequential');
    const module: RuleModule = {
      meta: {
        ruleId: ruleEntry.ruleId,
        name: ruleEntry.name,
        description: 'force rank lowest across separate hook firings',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        onGameStart: () => [
          { type: 'forceRank', player: 'p2', rank: 'lowest' },
        ],
        afterPlay: () => [{ type: 'forceRank', player: 'p3', rank: 'lowest' }],
      },
    };
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'force-rank-lowest-sequential',
      ruleChain: [ruleEntry],
    };
    const started = startGame(config, runtime(module)).state;
    // onGameStart のフック発火で p2 が先に最下位(4位)へ解決される。
    expect(started.players.p2?.standing).toBe(4);

    const player = started.public.turn;
    const card = player ? started.players[player]?.hand[0] : undefined;
    if (!player || !card) {
      throw new Error('Expected opening play');
    }
    const transition = reduceGame(
      config,
      started,
      { type: 'play', player, cards: [card.id] },
      runtime(module),
    );

    // afterPlay のフック発火で p3 は後着のため、4位が埋まっており近傍の3位になる。
    expect(transition.state.players.p3?.standing).toBe(3);
  });

  it("forceRankのrankペイロード検証: 'lowest'は受理し、'foo'や5は棄却する", () => {
    const ruleEntry = entry('r0108-force-rank-payload-validation');
    const module: RuleModule = {
      meta: {
        ruleId: ruleEntry.ruleId,
        name: ruleEntry.name,
        description: 'force rank payload validation',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        onGameStart: () =>
          [
            { type: 'forceRank', player: 'p2', rank: 'lowest' },
            { type: 'forceRank', player: 'p3', rank: 'foo' },
            { type: 'forceRank', player: 'p4', rank: 5 },
          ] as never,
      },
    };
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'force-rank-payload-validation',
      ruleChain: [ruleEntry],
    };

    const started = startGame(config, runtime(module));

    expect(started.state.players.p2?.standing).toBe(4);
    expect(
      started.events.filter(
        (event) =>
          event.type === 'effectRejected' &&
          event.detail &&
          typeof event.detail === 'object' &&
          !Array.isArray(event.detail) &&
          event.detail.reason === 'invalid-payload',
      ),
    ).toHaveLength(2);
  });

  it('skipTurnsをパスとして消化し、全員分なら場を流してリードへ戻す', () => {
    const ruleEntry = entry('r0105-skip-pass');
    const module: RuleModule = {
      meta: {
        ruleId: ruleEntry.ruleId,
        name: ruleEntry.name,
        description: 'skip as pass',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        afterPlay: () => [
          { type: 'skipTurns', player: 'p2', count: 1 },
          { type: 'skipTurns', player: 'p3', count: 1 },
          { type: 'skipTurns', player: 'p4', count: 1 },
        ],
      },
    };
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'skip-as-pass',
      ruleChain: [ruleEntry],
    };
    const started = startGame(config).state;
    const state: GameState = {
      ...started,
      public: { ...started.public, turn: 'p1' },
    };
    const card = state.players.p1?.hand[0];
    if (!card) {
      throw new Error('Expected p1 card');
    }

    const transition = reduceGame(
      config,
      state,
      { type: 'play', player: 'p1', cards: [card.id] },
      runtime(module),
    );

    expect(
      transition.events.filter((event) => event.type === 'passed'),
    ).toEqual([
      { type: 'passed', player: 'p2' },
      { type: 'passed', player: 'p3' },
      { type: 'passed', player: 'p4' },
    ]);
    expect(transition.events).toContainEqual({
      type: 'fieldCleared',
      reason: 'allPassed',
      nextLeader: 'p1',
    });
    expect(transition.state.public.field.current).toBeUndefined();
    expect(transition.state.public.turn).toBe('p1');
  });

  it('afterFieldClearの退場でactiveが1人になったらその場で終局する', () => {
    const ruleEntry = entry('r0108-field-clear-finish');
    const module: RuleModule = {
      meta: {
        ruleId: ruleEntry.ruleId,
        name: ruleEntry.name,
        description: 'finish after field clear',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        afterPlay: () => [
          { type: 'skipTurns', player: 'p2', count: 1 },
          { type: 'skipTurns', player: 'p3', count: 1 },
          { type: 'skipTurns', player: 'p4', count: 1 },
        ],
        afterFieldClear: () => [
          { type: 'forceRank', player: 'p2', rank: 2 },
          { type: 'forceRank', player: 'p3', rank: 3 },
          { type: 'forceRank', player: 'p4', rank: 4 },
        ],
      },
    };
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'field-clear-finish',
      ruleChain: [ruleEntry],
    };
    const started = startGame(config).state;
    const state: GameState = {
      ...started,
      public: { ...started.public, turn: 'p1' },
    };
    const card = state.players.p1?.hand[0];
    if (!card) {
      throw new Error('Expected p1 card');
    }

    const transition = reduceGame(
      config,
      state,
      { type: 'play', player: 'p1', cards: [card.id] },
      runtime(module),
    );

    expect(transition.state.public.phase).toBe('finished');
    expect(transition.state.public.turn).toBeNull();
    expect(transition.state.players.p1?.standing).toBe(1);
    expect(transition.events.at(-1)?.type).toBe('gameEnded');
    expect(
      transition.state.public.history.filter(
        (event) => event.type === 'fieldCleared',
      ),
    ).toHaveLength(1);
    for (const player of ['p2', 'p3', 'p4']) {
      expect(
        transition.state.public.history.filter(
          (event) => event.type === 'playerRetired' && event.player === player,
        ),
      ).toHaveLength(1);
    }
  });

  it('onGameStartのmoveCardsで手札が0枚になったactiveへ順位を付ける', () => {
    const ruleEntry = entry('r0109-start-empty-hand');
    const module: RuleModule = {
      meta: {
        ruleId: ruleEntry.ruleId,
        name: ruleEntry.name,
        description: 'empty hand on start',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        onGameStart: (context) => {
          const player = context.game.turn;
          return player
            ? [
                {
                  type: 'moveCards',
                  from: { kind: 'hand', player },
                  to: { kind: 'discard' },
                  cards: { kind: 'all' },
                },
              ]
            : [];
        },
      },
    };
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'start-empty-hand',
      ruleChain: [ruleEntry],
    };

    const transition = startGame(config, runtime(module));
    const emptied = seats.find(
      (player) => transition.state.players[player]?.hand.length === 0,
    );

    expect(emptied).toBeDefined();
    expect(transition.state.players[emptied!]).toMatchObject({
      status: 'finished',
      standing: 1,
    });
    expect(transition.state.public.phase).toBe('awaitingPlay');
    expect(transition.state.public.turn).not.toBe(emptied);
  });

  it('KVクォータ超過をEffect拒否として記録し、既存メモリを保つ', () => {
    const ruleEntry = entry('r0106-memory-quota');
    const module: RuleModule = {
      meta: {
        ruleId: ruleEntry.ruleId,
        name: ruleEntry.name,
        description: 'memory quota',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        afterPlay: () => [
          {
            type: 'setMemory',
            scope: 'game',
            key: 'overflow',
            value: true,
          },
        ],
      },
    };
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'memory-quota',
      ruleChain: [ruleEntry],
    };
    const started = startGame(config).state;
    const state: GameState = {
      ...started,
      private: {
        ...started.private,
        memory: {
          [ruleEntry.ruleId]: Object.fromEntries(
            Array.from({ length: 32 }, (_, index) => [`key-${index}`, index]),
          ),
        },
      },
    };
    const player = state.public.turn;
    const card = player ? state.players[player]?.hand[0] : undefined;
    if (!player || !card) {
      throw new Error('Expected opening play');
    }

    const transition = reduceGame(
      config,
      state,
      { type: 'play', player, cards: [card.id] },
      runtime(module),
    );
    const resolution = transition.events.find(
      (event) =>
        event.type === 'effectRejected' &&
        event.ruleId === ruleEntry.ruleId &&
        event.effect.type === 'setMemory',
    );

    expect(resolution).toMatchObject({
      type: 'effectRejected',
      resolution: 'rejected',
      detail: { applied: false, reason: 'key-quota' },
    });
    expect(
      transition.state.private.memory[ruleEntry.ruleId]?.overflow,
    ).toBeUndefined();
    expect(transition.state.public.firedRules).not.toContain(ruleEntry.ruleId);
  });

  it('場とランクが合わないmoveCardsは原子的に拒否してカードを失わない', () => {
    const ruleEntry = entry('r0107-atomic-move');
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'atomic-move',
      ruleChain: [ruleEntry],
    };
    const started = startGame(config).state;
    const player = started.public.turn;
    const played = player ? started.players[player]?.hand[0] : undefined;
    const source = seats.find((candidate) => candidate !== player);
    const moved = source
      ? started.players[source]?.hand.find(
          (candidate) =>
            candidate.kind === 'natural' &&
            played?.kind === 'natural' &&
            candidate.rank !== played.rank,
        )
      : undefined;
    if (!player || !played || !source || !moved) {
      throw new Error('Expected incompatible field move cards');
    }
    const module: RuleModule = {
      meta: {
        ruleId: ruleEntry.ruleId,
        name: ruleEntry.name,
        description: 'atomic move',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        afterPlay: () => [
          {
            type: 'moveCards',
            from: { kind: 'hand', player: source },
            to: { kind: 'field' },
            cards: { kind: 'specific', cardIds: [moved.id] },
          },
        ],
      },
    };

    const transition = reduceGame(
      config,
      started,
      { type: 'play', player, cards: [played.id] },
      runtime(module),
    );

    expect(
      transition.state.players[source]?.hand.some(
        (card) => card.id === moved.id,
      ),
    ).toBe(true);
    expect(transition.events).toContainEqual(
      expect.objectContaining({
        type: 'effectRejected',
        ruleId: ruleEntry.ruleId,
        detail: {
          applied: false,
          reason: 'incompatible-field-cards',
        },
      }),
    );
    const allCards = [
      ...Object.values(transition.state.players).flatMap(
        (candidate) => candidate.hand,
      ),
      ...(transition.state.public.field.current?.play.cards ?? []),
      ...transition.state.public.discard,
      ...transition.state.private.excluded,
    ];
    expect(allCards).toHaveLength(52);
    expect(new Set(allCards.map((card) => card.id))).toHaveLength(52);
  });

  it('fieldから同じfieldへの全札moveCardsを棄却してカードを保つ', () => {
    const ruleEntry = entry('r0110-same-field-move');
    const module: RuleModule = {
      meta: {
        ruleId: ruleEntry.ruleId,
        name: ruleEntry.name,
        description: 'same field move',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        afterPlay: () => [
          {
            type: 'moveCards',
            from: { kind: 'field' },
            to: { kind: 'field' },
            cards: { kind: 'all' },
          },
        ],
      },
    };
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'same-field-move',
      ruleChain: [ruleEntry],
    };
    const started = startGame(config).state;
    const player = started.public.turn;
    const card = player ? started.players[player]?.hand[0] : undefined;
    if (!player || !card) {
      throw new Error('Expected opening play');
    }

    const transition = reduceGame(
      config,
      started,
      { type: 'play', player, cards: [card.id] },
      runtime(module),
    );
    const allCards = [
      ...Object.values(transition.state.players).flatMap(
        (candidate) => candidate.hand,
      ),
      ...(transition.state.public.field.current?.play.cards ?? []),
      ...transition.state.public.discard,
      ...transition.state.private.excluded,
    ];

    expect(transition.state.public.field.current?.play.cards).toContainEqual(
      card,
    );
    expect(allCards).toHaveLength(52);
    expect(new Set(allCards.map((candidate) => candidate.id))).toHaveLength(52);
    expect(transition.events).toContainEqual(
      expect.objectContaining({
        type: 'effectRejected',
        detail: { applied: false, reason: 'same-zone' },
      }),
    );
  });

  it('権威フックだけが呼出し回数を進め、ルールごとのKVだけを公開する', () => {
    const ruleEntry = entry('r0103-context');
    const seen: unknown[] = [];
    const module: RuleModule = {
      meta: {
        ruleId: ruleEntry.ruleId,
        name: ruleEntry.name,
        description: 'context memory',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        afterPlay: (context) => {
          seen.push(context.memory.game.own, context.memory.game.other);
          return [];
        },
      },
    };
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'context-memory',
      ruleChain: [ruleEntry],
    };
    const started = startGame(config).state;
    const state: GameState = {
      ...started,
      private: {
        ...started.private,
        memory: {
          [ruleEntry.ruleId]: { own: 'visible' },
          'r-other': { other: 'hidden' },
        },
      },
    };
    const player = state.public.turn;
    const card = player ? state.players[player]?.hand[0] : undefined;
    if (!player || !card) {
      throw new Error('Expected opening play');
    }
    const transition = reduceGame(
      config,
      state,
      { type: 'play', player, cards: [card.id] },
      runtime(module),
    );

    expect(seen).toEqual(['visible', undefined]);
    expect(
      transition.state.private.hookCalls[`${ruleEntry.ruleId}:afterPlay`],
    ).toBe(1);
  });

  it('announceのmessageKey・paramsから非公開カードIDを配信しない', () => {
    const ruleEntry = entry('r0111-private-announce');
    let leakedCardId = '';
    const module: RuleModule = {
      meta: {
        ruleId: ruleEntry.ruleId,
        name: ruleEntry.name,
        description: 'private announce probe',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        afterPlay: (context) => {
          leakedCardId =
            context.game.players.find(
              (candidate) => candidate.id !== context.game.turn,
            )?.hand[0]?.id ?? '';
          return [
            {
              type: 'announce',
              messageKey: 'probe',
              params: { card: leakedCardId },
            },
          ];
        },
      },
    };
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'private-announce',
      ruleChain: [ruleEntry],
    };
    const started = startGame(config).state;
    const player = started.public.turn;
    const card = player ? started.players[player]?.hand[0] : undefined;
    const privateCard = Object.values(started.players).find(
      (candidate) => candidate.id !== player,
    )?.hand[0];
    if (!player || !card || !privateCard || privateCard.kind !== 'natural') {
      throw new Error('Expected opening play');
    }
    const stateWithPriorDisclosure: GameState = {
      ...started,
      public: {
        ...started.public,
        history: [
          ...started.public.history,
          {
            type: 'played',
            player,
            play: {
              kind: 'single',
              cards: [privateCard],
              count: 1,
              repRank: privateCard.rank,
            },
          },
        ],
      },
    };

    const transition = reduceGame(
      config,
      stateWithPriorDisclosure,
      { type: 'play', player, cards: [card.id] },
      runtime(module),
    );

    expect(leakedCardId).toBe(privateCard.id);
    expect(transition.events.some((event) => event.type === 'ruleFired')).toBe(
      false,
    );
    expect(transition.events).toContainEqual(
      expect.objectContaining({
        type: 'effectRejected',
        ruleId: ruleEntry.ruleId,
        detail: {
          applied: false,
          reason: 'private-card-reference',
        },
      }),
    );
  });

  it('同一Effectバッチで手札へ戻したカードIDをannounceしない', () => {
    const ruleEntry = entry('r0112-rehidden-announce');
    const hiddenCard = createDeck().find(
      (card) => card.kind === 'natural' && card.rank === '7',
    );
    if (!hiddenCard) {
      throw new Error('Expected a hidden card');
    }
    const module: RuleModule = {
      meta: {
        ruleId: ruleEntry.ruleId,
        name: ruleEntry.name,
        description: 'same-batch rehidden announce probe',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        afterPlay: () => [
          {
            type: 'moveCards',
            from: { kind: 'discard' },
            to: { kind: 'hand', player: 'p4' },
            cards: { kind: 'specific', cardIds: [hiddenCard.id] },
          },
          {
            type: 'announce',
            messageKey: 'probe',
            params: { card: hiddenCard.id },
          },
        ],
      },
    };
    const fixture = oneCardState([ruleEntry]);
    const state: GameState = {
      ...fixture.state,
      public: {
        ...fixture.state.public,
        discard: [hiddenCard],
      },
    };
    const card = state.players.p1?.hand[0];
    if (!card) {
      throw new Error('Expected an opening card');
    }

    const transition = reduceGame(
      fixture.config,
      state,
      { type: 'play', player: 'p1', cards: [card.id] },
      runtime(module),
    );

    expect(
      transition.state.players.p4?.hand.some(
        (candidate) => candidate.id === hiddenCard.id,
      ),
    ).toBe(true);
    expect(transition.events).toContainEqual({
      type: 'ruleFired',
      ruleId: ruleEntry.ruleId,
      messageKey: null,
    });
    expect(transition.events).toContainEqual(
      expect.objectContaining({
        type: 'effectRejected',
        effect: expect.objectContaining({ type: 'announce' }),
        detail: {
          applied: false,
          reason: 'private-card-reference',
        },
      }),
    );
  });

  it('有限整数でないEffect payloadを適用前に棄却する', () => {
    const ruleEntry = entry('r0113-invalid-effect');
    const module: RuleModule = {
      meta: {
        ruleId: ruleEntry.ruleId,
        name: ruleEntry.name,
        description: 'invalid numeric payload probe',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        afterPlay: () =>
          seats.map((player) => ({
            type: 'skipTurns' as const,
            player,
            count: Number.NaN,
          })),
      },
    };
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'invalid-effect-payload',
      ruleChain: [ruleEntry],
    };
    const started = startGame(config).state;
    const player = started.public.turn;
    const card = player ? started.players[player]?.hand[0] : undefined;
    if (!player || !card) {
      throw new Error('Expected an opening play');
    }

    const transition = reduceGame(
      config,
      started,
      { type: 'play', player, cards: [card.id] },
      runtime(module),
    );

    expect(transition.rejections).toEqual([]);
    expect(
      transition.events.filter(
        (event) =>
          event.type === 'effectRejected' &&
          event.detail &&
          typeof event.detail === 'object' &&
          !Array.isArray(event.detail) &&
          event.detail.reason === 'invalid-payload',
      ),
    ).toHaveLength(4);
  });

  it('不正なEffect形状・scope・paramsを例外なく棄却する', () => {
    const ruleEntry = entry('r0114-invalid-shapes');
    const module: RuleModule = {
      meta: {
        ruleId: ruleEntry.ruleId,
        name: ruleEntry.name,
        description: 'invalid effect shapes',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        onGameStart: () =>
          [
            {
              type: 'moveCards',
              to: { kind: 'discard' },
              cards: { kind: 'all' },
            },
            {
              type: 'setMemory',
              scope: 'bogus',
              key: 'bad',
              value: true,
            },
            {
              type: 'announce',
              messageKey: 'bad',
              params: null,
            },
          ] as never,
      },
    };
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'invalid-effect-shapes',
      ruleChain: [ruleEntry],
    };

    const started = startGame(config, runtime(module));

    expect(started.state.public.phase).toBe('awaitingPlay');
    expect(
      started.events.filter(
        (event) =>
          event.type === 'effectRejected' &&
          event.detail &&
          typeof event.detail === 'object' &&
          !Array.isArray(event.detail) &&
          event.detail.reason === 'invalid-payload',
      ),
    ).toHaveLength(3);
    expect(started.state.public.history).not.toContainEqual(
      expect.objectContaining({ type: 'ruleFired' }),
    );
  });

  it('Effect配列でないhook返値を無作用として隔離する', () => {
    const ruleEntry = entry('r0115-non-array-effects');
    const module: RuleModule = {
      meta: {
        ruleId: ruleEntry.ruleId,
        name: ruleEntry.name,
        description: 'non-array effect result',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        onGameStart: () => ({ type: 'reverseTurnOrder' }) as never,
      },
    };
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'non-array-effects',
      ruleChain: [ruleEntry],
    };

    expect(() => startGame(config, runtime(module))).not.toThrow();
  });

  it('余剰フィールド・非JSON値・不正rankを適用せずJSON安全に棄却する', () => {
    const ruleEntry = entry('r0116-json-boundary');
    const module: RuleModule = {
      meta: {
        ruleId: ruleEntry.ruleId,
        name: ruleEntry.name,
        description: 'non-JSON effect boundary probe',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        onGameStart: () =>
          [
            { type: 'reverseTurnOrder', extra: Number.NaN },
            { type: 'reverseTurnOrder', extra: Number.POSITIVE_INFINITY },
            { type: 'reverseTurnOrder', extra: 1n },
            { type: 'reverseTurnOrder', extra: new Date(0) },
            { type: 'reverseTurnOrder', extra: new Map([['x', 1]]) },
            { type: 'reverseTurnOrder', extra: undefined },
            {
              type: 'moveCards',
              from: { kind: 'hand', player: 'p1' },
              to: { kind: 'discard' },
              cards: { kind: 'byRank', rank: 'bogus' },
            },
          ] as never,
      },
    };
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'json-effect-boundary',
      ruleChain: [ruleEntry],
    };

    const started = startGame(config, runtime(module));

    expect(started.state.public.direction).toBe(1);
    expect(
      started.events.filter(
        (event) =>
          event.type === 'effectRejected' &&
          event.detail &&
          typeof event.detail === 'object' &&
          !Array.isArray(event.detail) &&
          event.detail.reason === 'invalid-payload',
      ),
    ).toHaveLength(7);
    expect(() => JSON.stringify(started)).not.toThrow();
  });

  it('公開RuleChainPortの非配列effectsを例外なく棄却する', () => {
    const ruleEntry = entry('r0117-invalid-port-effects');
    const basePort = createInProcessRuleChainPort([]);
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'invalid-port-effects',
      ruleChain: [ruleEntry],
    };
    const invalidRuntime: RuleRuntime = {
      port: {
        ...basePort,
        collectEffects: () =>
          [{ ruleId: ruleEntry.ruleId, effects: null }] as never,
      },
      setHistory: [],
      setMemory: {},
    };

    const started = startGame(config, invalidRuntime);

    expect(started.state.public.phase).toBe('awaitingPlay');
    expect(started.events).toContainEqual(
      expect.objectContaining({
        type: 'effectRejected',
        ruleId: ruleEntry.ruleId,
        detail: { reason: 'invalid-payload' },
      }),
    );
    expect(() => JSON.stringify(started)).not.toThrow();
  });

  it('公開RuleChainPortがruleIdを分割してもEffect上限を合算する', () => {
    const ruleEntry = entry('r0118-duplicate-port-entry');
    const basePort = createInProcessRuleChainPort([]);
    const effects = Array.from({ length: 16 }, (_, index) => ({
      type: 'setMemory' as const,
      scope: 'game' as const,
      key: `key-${index}`,
      value: index,
    }));
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'duplicate-port-entry',
      ruleChain: [ruleEntry],
    };
    const duplicateRuntime: RuleRuntime = {
      port: {
        ...basePort,
        collectEffects: () => [
          { ruleId: ruleEntry.ruleId, effects: effects.slice(0, 8) },
          { ruleId: ruleEntry.ruleId, effects: effects.slice(8) },
        ],
      },
      setHistory: [],
      setMemory: {},
    };

    const started = startGame(config, duplicateRuntime);

    expect(
      Object.keys(started.state.private.memory[ruleEntry.ruleId] ?? {}),
    ).toHaveLength(8);
    expect(
      started.events.filter(
        (event) =>
          event.type === 'effectRejected' &&
          event.detail &&
          typeof event.detail === 'object' &&
          !Array.isArray(event.detail) &&
          event.detail.reason === 'effect-limit',
      ),
    ).toHaveLength(8);
  });

  it('公開RuleChainPortのEffect入出力を権威状態から隔離する', () => {
    const ruleEntry = entry('r0120-isolated-port-effects');
    const basePort = createInProcessRuleChainPort([]);
    const retainedValue = { nested: { value: 'before' } };
    let entriesFrozen = false;
    let argumentFrozen = false;
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'isolated-port-effects',
      ruleChain: [ruleEntry],
    };
    const isolatedRuntime: RuleRuntime = {
      port: {
        ...basePort,
        collectEffects: (hook, entries, _context, argument) => {
          if (hook !== 'afterPlay') {
            return [];
          }
          try {
            entries[0]!.ruleId = 'CORRUPTED-RULE';
          } catch {
            entriesFrozen = true;
          }
          try {
            const mutable = argument as {
              cards: { id: string; rank: string }[];
            };
            mutable.cards[0]!.id = 'CORRUPTED';
            mutable.cards[0]!.rank = '2';
          } catch {
            argumentFrozen = true;
          }
          return [
            {
              ruleId: ruleEntry.ruleId,
              effects: [
                {
                  type: 'setMemory',
                  scope: 'game',
                  key: 'retained',
                  value: retainedValue,
                },
              ],
            },
          ];
        },
      },
      setHistory: [],
      setMemory: {},
    };
    const started = startGame(config, isolatedRuntime);
    const player = started.state.public.turn;
    const card = player ? started.state.players[player]?.hand[0] : undefined;
    if (!player || !card || card.kind !== 'natural') {
      throw new Error('Expected opening play');
    }
    const original = { id: card.id, rank: card.rank };

    const transition = reduceGame(
      config,
      started.state,
      { type: 'play', player, cards: [card.id] },
      isolatedRuntime,
    );
    retainedValue.nested.value = 'after';

    expect(entriesFrozen).toBe(true);
    expect(argumentFrozen).toBe(true);
    expect(config.ruleChain[0]?.ruleId).toBe(ruleEntry.ruleId);
    expect(transition.state.public.field.current?.play.cards[0]).toMatchObject(
      original,
    );
    expect(transition.state.private.memory[ruleEntry.ruleId]?.retained).toEqual(
      {
        nested: { value: 'before' },
      },
    );
    expect(
      transition.state.private.memory[ruleEntry.ruleId]?.retained,
    ).not.toBe(retainedValue);
  });

  it('onGameStartのskipTurnsを第1手番前に消化する', () => {
    const ruleEntry = entry('r0119-opening-skip');
    let skipped = '';
    const module: RuleModule = {
      meta: {
        ruleId: ruleEntry.ruleId,
        name: ruleEntry.name,
        description: 'opening skip',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        onGameStart: (context) => {
          skipped = context.game.turn ?? '';
          return [{ type: 'skipTurns', player: skipped, count: 1 }];
        },
      },
    };
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'opening-skip',
      ruleChain: [ruleEntry],
    };

    const started = startGame(config, runtime(module));
    const card = started.state.players[skipped]?.hand[0];
    if (!card) {
      throw new Error('Expected skipped player card');
    }
    const attempted = reduceGame(
      config,
      started.state,
      { type: 'play', player: skipped, cards: [card.id] },
      runtime(module),
    );

    expect(started.state.public.turn).not.toBe(skipped);
    expect(started.state.players[skipped]?.skipCount).toBe(0);
    expect(started.events).toContainEqual({ type: 'passed', player: skipped });
    expect(attempted.rejections).toContainEqual(
      expect.objectContaining({ code: 'NOT_YOUR_TURN' }),
    );
  });
});
