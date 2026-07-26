import { describe, expect, it } from 'vitest';

import type { GameConfig, GameState } from '../game/types.js';
import { startGame } from '../game/start-game.js';
import { reduceGame } from '../engine/reducer.js';
import { samePlay } from '../play/play.js';
import { buildPlayerSnapshot } from '../snapshot/snapshot.js';
import { NO_RULE_CHAIN_PORT, type RuleRuntime } from './chain.js';
import type { RuleChainEntry, RuleModule } from './contract.js';
import { createInProcessRuleChainPort } from './in-process.js';

const ruleEntry: RuleChainEntry = {
  ruleId: 'r0001-yagiri',
  name: '8切り',
  position: 0,
  priority: {
    popularityScore: 0,
    activatedAt: '2026-07-26T00:00:00.000Z',
    ruleId: 'r0001-yagiri',
  },
  bundleHash: 'fixture',
  contractVersion: 1,
};

const yagiri: RuleModule = {
  meta: {
    ruleId: ruleEntry.ruleId,
    name: ruleEntry.name,
    description: '8を出すと場が流れる',
    kind: 'local',
    proposalId: 'fixture',
    contractVersion: 1,
    messages: {
      fired: '8切り!',
    },
  },
  hooks: {
    afterPlay: (_context, play) =>
      play.repRank === '8'
        ? [{ type: 'clearField' }, { type: 'announce', messageKey: 'fired' }]
        : [],
  },
};

function fixtureEntry(ruleId: string, position: number): RuleChainEntry {
  return {
    ruleId,
    name: ruleId,
    position,
    priority: {
      popularityScore: 0,
      activatedAt: '2026-07-26T00:00:00.000Z',
      ruleId,
    },
    bundleHash: 'fixture',
    contractVersion: 1,
  };
}

function stateWithEight(config: GameConfig): {
  state: GameState;
  player: string;
  cardId: string;
} {
  const state = startGame(config).state;
  const player = config.seats.find((id) =>
    state.players[id]?.hand.some((card) => card.rank === '8'),
  );
  const card = player
    ? state.players[player]?.hand.find((candidate) => candidate.rank === '8')
    : undefined;
  if (!player || !card) {
    throw new Error('Expected an eight');
  }
  return {
    state: {
      ...state,
      public: {
        ...state.public,
        turn: player,
        field: { passedSinceLastPlay: [] },
      },
    },
    player,
    cardId: card.id,
  };
}

describe('GE-04 independent rule modules', () => {
  it('8切りルールの有効・無効で同じプレイの挙動が変わる', () => {
    const enabledConfig: GameConfig = {
      gameIndex: 0,
      seats: ['p1', 'p2', 'p3', 'p4'],
      gameSeed: 'rules',
      ruleChain: [ruleEntry],
    };
    const prepared = stateWithEight(enabledConfig);
    const enabledRuntime: RuleRuntime = {
      port: createInProcessRuleChainPort([yagiri]),
      setHistory: [],
      setMemory: {},
    };

    const enabled = reduceGame(
      enabledConfig,
      prepared.state,
      {
        type: 'play',
        player: prepared.player,
        cards: [prepared.cardId],
      },
      enabledRuntime,
    );
    expect(enabled.state.public.field.current).toBeUndefined();
    expect(enabled.events).toContainEqual({
      type: 'ruleFired',
      ruleId: ruleEntry.ruleId,
      messageKey: 'fired',
    });
    expect(enabled.state.public.firedRules).toContain(ruleEntry.ruleId);

    const disabledConfig = { ...enabledConfig, ruleChain: [] };
    const disabled = reduceGame(
      disabledConfig,
      prepared.state,
      {
        type: 'play',
        player: prepared.player,
        cards: [prepared.cardId],
      },
      {
        port: NO_RULE_CHAIN_PORT,
        setHistory: [],
        setMemory: {},
      },
    );
    expect(disabled.state.public.field.current?.play.repRank).toBe('8');
    expect(disabled.events.some((event) => event.type === 'ruleFired')).toBe(
      false,
    );
  });

  it('登録されていないルールIDは呼び出さず基本進行を続ける', () => {
    const config: GameConfig = {
      gameIndex: 0,
      seats: ['p1', 'p2', 'p3', 'p4'],
      gameSeed: 'missing-rule',
      ruleChain: [ruleEntry],
    };
    const prepared = stateWithEight(config);
    const transition = reduceGame(
      config,
      prepared.state,
      {
        type: 'play',
        player: prepared.player,
        cards: [prepared.cardId],
      },
      {
        port: createInProcessRuleChainPort([]),
        setHistory: [],
        setMemory: {},
      },
    );
    expect(transition.rejections).toEqual([]);
    expect(transition.state.public.field.current?.play.repRank).toBe('8');
  });

  it('ルールへ渡すビューを権威状態から切り離し、深く凍結する', () => {
    const entry = fixtureEntry('r0002-mutation-probe', 0);
    let mutationRejected = false;
    const mutationProbe: RuleModule = {
      meta: {
        ruleId: entry.ruleId,
        name: entry.name,
        description: '権威状態への直接変更を試す',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        afterPlay(context) {
          try {
            (
              context.game.field as unknown as {
                current?: unknown;
              }
            ).current = undefined;
          } catch {
            mutationRejected = true;
          }
          return [];
        },
      },
    };
    const config: GameConfig = {
      gameIndex: 0,
      seats: ['p1', 'p2', 'p3', 'p4'],
      gameSeed: 'immutable-rule-view',
      ruleChain: [entry],
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
      {
        port: createInProcessRuleChainPort([mutationProbe]),
        setHistory: [],
        setMemory: {},
      },
    );

    expect(mutationRejected).toBe(true);
    expect(transition.state.public.field.current?.play.cards).toContainEqual(
      card,
    );
    expect(
      transition.events.some((event) => event.type === 'fieldCleared'),
    ).toBe(false);
  });

  it('hook固有引数の破壊を無視して権威状態とカードを保つ', () => {
    const entry = fixtureEntry('r0002b-argument-mutation', 0);
    const malicious: RuleModule = {
      meta: {
        ruleId: entry.ruleId,
        name: entry.name,
        description: 'play引数の破壊を試す',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        modifyStrength(_context, base) {
          (base.ranking as unknown as string[]).splice(0);
          return { ranking: [] };
        },
        modifyLegality(_context, play, base) {
          (play.cards as unknown as unknown[]).splice(0);
          return structuredClone(base);
        },
        afterPlay(_context, play) {
          (play.cards as unknown as unknown[]).splice(0);
          return [];
        },
      },
    };
    const config: GameConfig = {
      gameIndex: 0,
      seats: ['p1', 'p2', 'p3', 'p4'],
      gameSeed: 'immutable-hook-arguments',
      ruleChain: [entry],
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
      {
        port: createInProcessRuleChainPort([malicious]),
        setHistory: [],
        setMemory: {},
      },
    );
    const allCards = [
      ...Object.values(transition.state.players).flatMap(
        (candidate) => candidate.hand,
      ),
      ...(transition.state.public.field.current?.play.cards ?? []),
      ...transition.state.public.discard,
      ...transition.state.private.excluded,
    ];

    expect(transition.rejections).toEqual([]);
    expect(transition.state.public.field.current?.play.cards).toContainEqual(
      card,
    );
    expect(allCards).toHaveLength(52);
    expect(new Set(allCards.map((candidate) => candidate.id))).toHaveLength(52);
  });

  it('modifyLegality返値の複製中に例外が起きても基本進行を続ける', () => {
    const entry = fixtureEntry('r0002c-legality-getter', 0);
    const malicious: RuleModule = {
      meta: {
        ruleId: entry.ruleId,
        name: entry.name,
        description: '返値getterから例外を投げる',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        modifyLegality: () => ({
          get legal(): true {
            throw new Error('getter escaped');
          },
        }),
      },
    };
    const config: GameConfig = {
      gameIndex: 0,
      seats: ['p1', 'p2', 'p3', 'p4'],
      gameSeed: 'legality-return-isolation',
      ruleChain: [entry],
    };
    const started = startGame(config).state;
    const player = started.public.turn;
    const card = player ? started.players[player]?.hand[0] : undefined;
    if (!player || !card) {
      throw new Error('Expected an opening play');
    }

    expect(() =>
      reduceGame(
        config,
        started,
        { type: 'play', player, cards: [card.id] },
        {
          port: createInProcessRuleChainPort([malicious]),
          setHistory: [],
          setMemory: {},
        },
      ),
    ).not.toThrow();
  });

  it('modifyLegalityが不正な形状を返しても基本進行を続ける', () => {
    const entry = fixtureEntry('r0002d-invalid-legality', 0);
    const invalid: RuleModule = {
      meta: {
        ruleId: entry.ruleId,
        name: entry.name,
        description: '不正な合法性を返す',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        modifyLegality: () => null as never,
      },
    };
    const config: GameConfig = {
      gameIndex: 0,
      seats: ['p1', 'p2', 'p3', 'p4'],
      gameSeed: 'invalid-legality-return',
      ruleChain: [entry],
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
      {
        port: createInProcessRuleChainPort([invalid]),
        setHistory: [],
        setMemory: {},
      },
    );

    expect(transition.rejections).toEqual([]);
    expect(transition.state.public.field.current?.play.cards).toContainEqual(
      card,
    );
  });

  it('無作用ルールの乱数消費が別ルールの乱数列へ影響しない', () => {
    const consumerEntry = fixtureEntry('r0003-rng-consumer', 0);
    const observerEntry = fixtureEntry('r0004-rng-observer', 1);
    const observed: number[] = [];
    const consumer: RuleModule = {
      meta: {
        ruleId: consumerEntry.ruleId,
        name: consumerEntry.name,
        description: '自分の乱数を消費する',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        afterPlay(context) {
          context.rng.next();
          return [];
        },
      },
    };
    const observer: RuleModule = {
      meta: {
        ruleId: observerEntry.ruleId,
        name: observerEntry.name,
        description: '乱数列を観測する',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        afterPlay(context) {
          observed.push(context.rng.next());
          return [];
        },
      },
    };
    const baseConfig: GameConfig = {
      gameIndex: 0,
      seats: ['p1', 'p2', 'p3', 'p4'],
      gameSeed: 'independent-rule-rng',
      ruleChain: [observerEntry],
    };
    const started = startGame(baseConfig).state;
    const player = started.public.turn;
    const card = player ? started.players[player]?.hand[0] : undefined;
    if (!player || !card) {
      throw new Error('Expected an opening play');
    }

    reduceGame(
      baseConfig,
      started,
      { type: 'play', player, cards: [card.id] },
      {
        port: createInProcessRuleChainPort([observer]),
        setHistory: [],
        setMemory: {},
      },
    );
    reduceGame(
      {
        ...baseConfig,
        ruleChain: [consumerEntry, observerEntry],
      },
      started,
      { type: 'play', player, cards: [card.id] },
      {
        port: createInProcessRuleChainPort([consumer, observer]),
        setHistory: [],
        setMemory: {},
      },
    );

    expect(observed).toHaveLength(2);
    expect(observed[1]).toBe(observed[0]);
  });

  it('リード手詰まり時は表示した合法手を権威判定でも受理する', () => {
    const entry = fixtureEntry('r0005-forbid-all', 0);
    const forbidAll: RuleModule = {
      meta: {
        ruleId: entry.ruleId,
        name: entry.name,
        description: 'すべての候補を禁止する',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        modifyLegality: () => ({
          legal: false,
          reasonKey: 'fixture.forbid-all',
        }),
      },
    };
    const config: GameConfig = {
      gameIndex: 0,
      seats: ['p1', 'p2', 'p3', 'p4'],
      gameSeed: 'lead-failsafe',
      ruleChain: [entry],
    };
    const started = startGame(config).state;
    const player = started.public.turn;
    if (!player) {
      throw new Error('Expected an opening player');
    }
    const runtime: RuleRuntime = {
      port: createInProcessRuleChainPort([forbidAll]),
      setHistory: [],
      setMemory: {},
    };
    const snapshot = buildPlayerSnapshot(
      config,
      started,
      {
        setId: 'set-failsafe',
        setPhase: { name: 'gameInProgress', gameIndex: 0 },
        members: config.seats.map((id) => ({
          id,
          displayName: id,
          isAI: false,
        })),
        setResults: [],
      },
      player,
      runtime,
    );
    const legalMove = snapshot.legalMoves?.[0];
    if (!legalMove) {
      throw new Error('Expected a failsafe legal move');
    }

    const transition = reduceGame(
      config,
      started,
      {
        type: 'play',
        player,
        cards: legalMove.cards.map((card) => card.id),
      },
      runtime,
    );

    expect(transition.rejections).toEqual([]);
    expect(
      transition.state.public.field.current
        ? samePlay(transition.state.public.field.current.play, legalMove)
        : false,
    ).toBe(true);
    expect(transition.events).toContainEqual({
      type: 'failsafe',
      reason: 'leadNoLegalMove',
      relatedRuleIds: [entry.ruleId],
    });
  });
});
