import { describe, expect, it } from 'vitest';

import { createDeck } from '../cards/card.js';
import { reduceGame } from '../engine/reducer.js';
import { startGame } from '../game/start-game.js';
import type { GameConfig, GameState } from '../game/types.js';
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
      popularityScore: 0,
      activatedAt: '2026-07-26T00:00:00.000Z',
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
    const card = deck.find((candidate) => candidate.rank === rank);
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
          (candidate) => candidate.rank !== played?.rank,
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
    if (!player || !card) {
      throw new Error('Expected opening play');
    }

    const transition = reduceGame(
      config,
      started,
      { type: 'play', player, cards: [card.id] },
      runtime(module),
    );

    expect(leakedCardId).not.toBe('');
    expect(JSON.stringify(transition.state.public.history)).not.toContain(
      leakedCardId,
    );
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
});
