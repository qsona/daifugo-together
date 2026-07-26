import { describe, expect, it } from 'vitest';

import { startGame } from '../game/start-game.js';
import type { GameState, Standing } from '../game/types.js';
import { samePlay } from '../play/play.js';
import { BASE_STRENGTH_ORDER } from '../play/strength.js';
import type { RuleRuntime } from '../rules/chain.js';
import type { RuleChainEntry, RuleModule } from '../rules/contract.js';
import { createInProcessRuleChainPort } from '../rules/in-process.js';
import { createSimulationApi } from './api.js';

const seats = ['p1', 'p2', 'p3', 'p4'];
const config = {
  gameIndex: 0,
  seats,
  gameSeed: 'simulation-api',
  ruleChain: [],
};
const snapshotContext = {
  setId: 'simulation-set',
  setPhase: { name: 'gameInProgress' as const, gameIndex: 0 },
  members: seats.map((id) => ({
    id,
    displayName: id,
    isAI: id !== 'p1',
  })),
  setResults: [],
};

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

describe('E1 SimulationApi', () => {
  it('E2向けの合法手・適用・ビュー・fallback・直列化を一つの公開面で提供する', () => {
    const state = startGame(config).state;
    const player = state.public.turn;
    if (!player) {
      throw new Error('Expected an opening player');
    }
    const api = createSimulationApi({ config, snapshotContext });
    const position = api.createPosition(state);
    const beforeHookCalls = structuredClone(state.private.hookCalls);
    const legal = api.enumerateLegalPlays(position, player);
    const fallback = api.fallbackPlay(position, player);
    if (fallback.type !== 'play') {
      throw new Error('Lead fallback must play');
    }

    expect(
      legal.some((play) =>
        samePlay(play, {
          kind: fallback.cards.length === 1 ? 'single' : 'set',
          cards: state.players[player]!.hand.filter((card) =>
            fallback.cards.includes(card.id),
          ),
          count: fallback.cards.length,
          repRank: state.players[player]!.hand.find((card) =>
            fallback.cards.includes(card.id),
          )!.rank,
        }),
      ),
    ).toBe(true);
    expect(api.getEffectiveStrengthOrder(position)).toEqual(
      BASE_STRENGTH_ORDER,
    );
    const view = api.getPlayerView(position, player);
    expect(view.hand).toEqual(state.players[player]?.hand);
    expect(view.legalMoves).toEqual(legal);
    expect(state.private.hookCalls).toEqual(beforeHookCalls);

    const applied = api.applyPlay(position, fallback);
    expect(applied.events[0]?.type).toBe('played');
    expect(applied.position.state).not.toEqual(state);
    expect(JSON.parse(api.serialize(applied.position))).toEqual(
      applied.position,
    );
  });

  it('終局時だけ全順位を返す', () => {
    const state = startGame(config).state;
    const api = createSimulationApi({ config, snapshotContext });
    expect(api.isTerminal(api.createPosition(state))).toBeNull();

    const standings: Standing[] = [1, 2, 3, 4];
    const finished: GameState = {
      ...state,
      public: { ...state.public, phase: 'finished', turn: null },
      players: Object.fromEntries(
        seats.map((player, index) => [
          player,
          {
            ...state.players[player]!,
            status: 'finished' as const,
            standing: standings[index]!,
          },
        ]),
      ),
    };

    expect(api.isTerminal(api.createPosition(finished))?.standings).toEqual([
      { player: 'p1', standing: 1, title: '大富豪' },
      { player: 'p2', standing: 2, title: '富豪' },
      { player: 'p3', standing: 3, title: '貧民' },
      { player: 'p4', standing: 4, title: '大貧民' },
    ]);
  });

  it('setスコープKVをpositionに含めて複数手プレイアウトへ引き継ぐ', () => {
    const ruleEntry = entry('r1000-sim-set-memory');
    const module: RuleModule = {
      meta: {
        ruleId: ruleEntry.ruleId,
        name: ruleEntry.name,
        description: 'arm after first play',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        afterPlay: () => [
          {
            type: 'setMemory',
            scope: 'set',
            key: 'armed',
            value: true,
          },
        ],
        modifyLegality: (context, play, base) =>
          context.memory.set.armed === true && play.kind === 'single'
            ? { legal: false, reasonKey: 'ARMED' }
            : structuredClone(base),
      },
    };
    const ruleConfig = { ...config, ruleChain: [ruleEntry] };
    const state = startGame(ruleConfig, runtime(module)).state;
    const player = state.public.turn!;
    const api = createSimulationApi({
      config: ruleConfig,
      snapshotContext,
      runtime: runtime(module),
    });
    const position = api.createPosition(state);
    const first = api.fallbackPlay(position, player);
    const applied = api.applyPlay(position, first);
    const nextPlayer = applied.position.state.public.turn!;

    expect(applied.position.setMemory[ruleEntry.ruleId]?.armed).toBe(true);
    expect(
      api
        .enumerateLegalPlays(applied.position, nextPlayer)
        .some((play) => play.kind === 'single'),
    ).toBe(false);
  });

  it('リードで単騎が禁止されても合法な組をfallbackとして返す', () => {
    const ruleEntry = entry('r1001-pairs-only');
    const module: RuleModule = {
      meta: {
        ruleId: ruleEntry.ruleId,
        name: ruleEntry.name,
        description: 'pairs only',
        kind: 'original',
        proposalId: 'fixture',
        contractVersion: 1,
        messages: {},
      },
      hooks: {
        modifyLegality: (_context, play, base) =>
          play.kind === 'single'
            ? { legal: false, reasonKey: 'NO_SINGLE' }
            : structuredClone(base),
      },
    };
    const ruleConfig = { ...config, ruleChain: [ruleEntry] };
    const state = startGame(ruleConfig, runtime(module)).state;
    const player = seats.find((id) => {
      const hand = state.players[id]!.hand;
      return new Set(hand.map((card) => card.rank)).size < hand.length;
    });
    if (!player) {
      throw new Error('Expected a player with a pair');
    }
    const prepared: GameState = {
      ...state,
      public: {
        ...state.public,
        turn: player,
        field: { passedSinceLastPlay: [] },
      },
    };
    const api = createSimulationApi({
      config: ruleConfig,
      snapshotContext,
      runtime: runtime(module),
    });
    const position = api.createPosition(prepared);
    const legal = api.enumerateLegalPlays(position, player);
    const fallback = api.fallbackPlay(position, player);

    expect(legal.length).toBeGreaterThan(0);
    expect(legal.every((play) => play.kind === 'set')).toBe(true);
    expect(fallback.type).toBe('play');
    if (fallback.type === 'play') {
      expect(fallback.cards.length).toBeGreaterThan(1);
    }
  });
});
