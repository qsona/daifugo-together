import { describe, expect, it } from 'vitest';

import { startGame } from '../game/start-game.js';
import type { GameState, Standing } from '../game/types.js';
import { samePlay } from '../play/play.js';
import { BASE_STRENGTH_ORDER } from '../play/strength.js';
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

describe('E1 SimulationApi', () => {
  it('E2向けの合法手・適用・ビュー・fallback・直列化を一つの公開面で提供する', () => {
    const state = startGame(config).state;
    const player = state.public.turn;
    if (!player) {
      throw new Error('Expected an opening player');
    }
    const api = createSimulationApi({ config, snapshotContext });
    const beforeHookCalls = structuredClone(state.private.hookCalls);
    const legal = api.enumerateLegalPlays(state, player);
    const fallback = api.fallbackPlay(state, player);
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
    expect(api.getEffectiveStrengthOrder(state)).toEqual(BASE_STRENGTH_ORDER);
    const view = api.getPlayerView(state, player);
    expect(view.hand).toEqual(state.players[player]?.hand);
    expect(view.legalMoves).toEqual(legal);
    expect(state.private.hookCalls).toEqual(beforeHookCalls);

    const applied = api.applyPlay(state, fallback);
    expect(applied.events[0]?.type).toBe('played');
    expect(applied.state).not.toEqual(state);
    expect(JSON.parse(api.serialize(applied.state))).toEqual(applied.state);
  });

  it('終局時だけ全順位を返す', () => {
    const state = startGame(config).state;
    const api = createSimulationApi({ config, snapshotContext });
    expect(api.isTerminal(state)).toBeNull();

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

    expect(api.isTerminal(finished)?.standings).toEqual([
      { player: 'p1', standing: 1, title: '大富豪' },
      { player: 'p2', standing: 2, title: '富豪' },
      { player: 'p3', standing: 3, title: '貧民' },
      { player: 'p4', standing: 4, title: '大貧民' },
    ]);
  });
});
