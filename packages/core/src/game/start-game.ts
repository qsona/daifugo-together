import {
  createDeck,
  DIAMOND_THREE_ID,
  sortCards,
  type Card,
} from '../cards/card.js';
import { randomInt, nextRandom, seedRng, type RngState } from '../rng/rng.js';
import type {
  GameConfig,
  GameState,
  GameTransition,
  PlayerId,
} from './types.js';

function shuffle(cards: readonly Card[], initialRng: RngState) {
  const shuffled = [...cards];
  let rng = initialRng;
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const next = nextRandom(rng);
    rng = next.state;
    const target = Math.floor(next.value * (index + 1));
    const currentCard = shuffled[index];
    const targetCard = shuffled[target];
    if (!currentCard || !targetCard) {
      throw new Error('shuffle index is out of bounds');
    }
    shuffled[index] = targetCard;
    shuffled[target] = currentCard;
  }
  return { cards: shuffled, rng };
}

function deal(
  cards: readonly Card[],
  seats: readonly PlayerId[],
  startIndex: number,
): Record<PlayerId, Card[]> {
  const hands = Object.fromEntries(seats.map((seat) => [seat, []])) as Record<
    PlayerId,
    Card[]
  >;
  cards.forEach((card, index) => {
    const seat = seats[(startIndex + index) % seats.length];
    if (!seat) {
      throw new Error('deal seat is missing');
    }
    hands[seat]?.push(card);
  });
  for (const seat of seats) {
    hands[seat] = sortCards(hands[seat] ?? []);
  }
  return hands;
}

function validateConfig(config: GameConfig) {
  if (config.seats.length !== 4 || new Set(config.seats).size !== 4) {
    throw new Error('A game requires exactly four unique player seats');
  }
}

export function startGame(config: GameConfig): GameTransition {
  validateConfig(config);
  const shuffled = shuffle(createDeck(), seedRng(config.gameSeed));
  const start = randomInt(shuffled.rng, config.seats.length);
  const hands = deal(shuffled.cards, config.seats, start.value);
  const firstPlayer = config.seats.find((seat) =>
    hands[seat]?.some((card) => card.id === DIAMOND_THREE_ID),
  );
  if (!firstPlayer) {
    throw new Error('The diamond three must belong to a player');
  }

  const handCounts = Object.fromEntries(
    config.seats.map((seat) => [seat, hands[seat]?.length ?? 0]),
  );
  const gameStarted = {
    type: 'gameStarted' as const,
    firstPlayer,
    handCounts,
  };

  const state: GameState = {
    public: {
      phase: 'awaitingPlay',
      direction: 1,
      turn: firstPlayer,
      field: { passedSinceLastPlay: [] },
      discard: [],
      standingsTaken: [],
      history: [gameStarted],
      firedRules: [],
      turnCount: 0,
    },
    private: {
      excluded: [],
      memory: {},
      rng: start.state,
      hookCalls: {},
    },
    players: Object.fromEntries(
      config.seats.map((seat) => [
        seat,
        {
          id: seat,
          hand: hands[seat] ?? [],
          status: 'active' as const,
          skipCount: 0,
        },
      ]),
    ),
  };

  return { state, events: [gameStarted], rejections: [] };
}
