import { describe, expect, it } from 'vitest';

import { createDeck } from '../cards/card.js';
import { reduceGame } from '../engine/reducer.js';
import { seedRng } from '../rng/rng.js';
import type { GameConfig, GameState, PlayerId } from './types.js';

const seats = ['p1', 'p2', 'p3', 'p4'];
const cards = createDeck();

function oneCardState(): { config: GameConfig; state: GameState } {
  const config: GameConfig = {
    gameIndex: 0,
    seats,
    gameSeed: 'finish',
    ruleChain: [],
  };
  const byRank = ['3', '4', '5', '6'].map((rank) => {
    const card = cards.find(
      (candidate) => candidate.kind === 'natural' && candidate.rank === rank,
    );
    if (!card) {
      throw new Error(`Missing card rank: ${rank}`);
    }
    return card;
  });
  return {
    config,
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
        rng: seedRng('finish'),
        hookCalls: {},
      },
      players: Object.fromEntries(
        seats.map((id, index) => [
          id,
          {
            id,
            hand: [byRank[index]],
            status: 'active' as const,
            skipCount: 0,
          },
        ]),
      ) as GameState['players'],
    },
  };
}

function playOnlyCard(config: GameConfig, state: GameState, player: PlayerId) {
  const card = state.players[player]?.hand[0];
  if (!card) {
    throw new Error(`Missing card for ${player}`);
  }
  return reduceGame(config, state, {
    type: 'play',
    player,
    cards: [card.id],
  });
}

describe('GE-03 finishing and standings', () => {
  it('あがり順に順位と称号を付け、3人目のあがりで最後の1人を4位にする', () => {
    const game = oneCardState();

    const first = playOnlyCard(game.config, game.state, 'p1');
    expect(first.events).toContainEqual({
      type: 'playerFinished',
      player: 'p1',
      standing: 1,
      title: '大富豪',
    });
    expect(first.state.public.turn).toBe('p2');

    const second = playOnlyCard(game.config, first.state, 'p2');
    expect(second.state.players.p2?.standing).toBe(2);

    const third = playOnlyCard(game.config, second.state, 'p3');
    expect(third.state.public.phase).toBe('finished');
    expect(third.state.public.turn).toBeNull();
    expect(
      seats.map((player) => third.state.players[player]?.standing),
    ).toEqual([1, 2, 3, 4]);
    expect(third.state.players.p4?.hand).toHaveLength(1);
    expect(third.events.at(-1)).toEqual({
      type: 'gameEnded',
      standings: [
        { player: 'p1', standing: 1, title: '大富豪' },
        { player: 'p2', standing: 2, title: '富豪' },
        { player: 'p3', standing: 3, title: '貧民' },
        { player: 'p4', standing: 4, title: '大貧民' },
      ],
    });
  });

  it('終局後の操作を状態不変で拒否する', () => {
    const game = oneCardState();
    const first = playOnlyCard(game.config, game.state, 'p1');
    const second = playOnlyCard(game.config, first.state, 'p2');
    const third = playOnlyCard(game.config, second.state, 'p3');

    const rejected = reduceGame(game.config, third.state, {
      type: 'pass',
      player: 'p4',
    });
    expect(rejected.state).toBe(third.state);
    expect(rejected.rejections).toEqual([
      { player: 'p4', code: 'NOT_YOUR_TURN' },
    ]);
  });
});
