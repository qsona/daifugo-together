import { describe, expect, it } from 'vitest';

import { createDeck } from '../cards/card.js';
import { seedRng } from '../rng/rng.js';
import type { GameState, PlayerId } from '../game/types.js';
import { reduceSet, startSet } from './set-reducer.js';
import { scoreSet } from './scoring.js';
import type { SetState } from './types.js';

const ids = ['p1', 'p2', 'p3', 'p4'];
const members = ids.map((id) => ({
  id,
  displayName: id,
  isAI: id !== 'p1',
}));

function startedSet(gamesPerSet = 3) {
  return startSet({
    setId: 'set-1',
    config: { gamesPerSet, interimAutoAdvanceMs: 5_000 },
    members,
    ruleChain: [],
    setSeed: 'set-seed',
  });
}

function nearFinishGame(order: PlayerId[]): GameState {
  const deck = createDeck();
  const cards = ['3', '4', '5', '6'].map((rank) => {
    const card = deck.find((candidate) => candidate.rank === rank);
    if (!card) {
      throw new Error(`Missing rank: ${rank}`);
    }
    return card;
  });
  return {
    public: {
      phase: 'awaitingPlay',
      direction: 1,
      turn: order[0] ?? null,
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
      rng: seedRng('near-finish'),
      hookCalls: {},
    },
    players: Object.fromEntries(
      order.map((id, index) => [
        id,
        {
          id,
          hand: [cards[index]],
          status: 'active' as const,
          skipCount: 0,
        },
      ]),
    ) as GameState['players'],
  };
}

function finishGame(state: SetState, order: PlayerId[]): SetState {
  let current: SetState = {
    ...state,
    currentGame: nearFinishGame(order),
  };
  for (const player of order.slice(0, 3)) {
    const card = current.currentGame?.players[player]?.hand[0];
    if (!card) {
      throw new Error(`Missing card for ${player}`);
    }
    const transition = reduceSet(current, {
      type: 'play',
      player,
      cards: [card.id],
    });
    expect(transition.rejections).toEqual([]);
    current = transition.state;
  }
  return current;
}

describe('GE-05 set progression', () => {
  it('同じメンバーで3戦を進め、ゲーム間結果とセット結果を保持する', () => {
    let state = startedSet();
    const originalMembers = state.members;
    const orders = [
      ['p1', 'p2', 'p3', 'p4'],
      ['p2', 'p3', 'p4', 'p1'],
      ['p3', 'p4', 'p1', 'p2'],
    ];

    orders.forEach((order, index) => {
      state = finishGame(state, order);
      expect(state.results).toHaveLength(index + 1);
      expect(state.members).toBe(originalMembers);
      if (index < 2) {
        expect(state.phase).toEqual({
          name: 'interimResult',
          gameIndex: index,
        });
        const advanced = reduceSet(state, { type: 'advance' });
        expect(advanced.rejections).toEqual([]);
        state = advanced.state;
        expect(state.phase).toEqual({
          name: 'gameInProgress',
          gameIndex: index + 1,
        });
      }
    });

    expect(state.phase).toEqual({ name: 'setResult' });
    expect(state.outcome?.standings).toHaveLength(4);
    expect(state.outcome?.results).toHaveLength(3);
  });

  it('gamesPerSet を変更しても同じ状態機械で終了する', () => {
    let state = startedSet(1);
    state = finishGame(state, ['p1', 'p2', 'p3', 'p4']);
    expect(state.phase).toEqual({ name: 'setResult' });
  });

  it('順位点を合計し、同点は最終戦順位で決める', () => {
    const results = [
      {
        gameIndex: 0,
        standings: [
          { player: 'p1', standing: 1 as const, title: '大富豪' as const },
          { player: 'p2', standing: 2 as const, title: '富豪' as const },
          { player: 'p3', standing: 3 as const, title: '貧民' as const },
          { player: 'p4', standing: 4 as const, title: '大貧民' as const },
        ],
        firedRuleIds: [],
      },
      {
        gameIndex: 1,
        standings: [
          { player: 'p2', standing: 1 as const, title: '大富豪' as const },
          { player: 'p1', standing: 2 as const, title: '富豪' as const },
          { player: 'p3', standing: 3 as const, title: '貧民' as const },
          { player: 'p4', standing: 4 as const, title: '大貧民' as const },
        ],
        firedRuleIds: [],
      },
    ];
    const outcome = scoreSet('set-1', {
      members,
      ruleChain: [],
      results,
    });
    expect(outcome.standings.slice(0, 2)).toEqual([
      {
        player: 'p2',
        points: 7,
        totalStanding: 1,
        title: '大富豪',
      },
      {
        player: 'p1',
        points: 7,
        totalStanding: 2,
        title: '富豪',
      },
    ]);
  });
});
