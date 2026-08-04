import {
  createDeck,
  DIAMOND_THREE_ID,
  sortCards,
  type Card,
} from '../cards/card.js';
import { randomInt, nextRandom, seedRng, type RngState } from '../rng/rng.js';
import type {
  EngineEvent,
  GameConfig,
  GameState,
  GameTransition,
  PlayerId,
  PublicGameEvent,
} from './types.js';
import { noRuleRuntime, type RuleRuntime } from '../rules/chain.js';
import { engineFeaturesOf } from '../rules/contract.js';
import { executeEffectHook, type EffectHookResult } from '../engine/effects.js';
import { activePlayers, finishGame } from '../engine/standing.js';

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

function appendPublicEvents(
  state: GameState,
  events: readonly EngineEvent[],
): GameState {
  const publicEvents = events.filter(
    (event): event is PublicGameEvent =>
      event.type !== 'effectApplied' && event.type !== 'effectRejected',
  );
  return {
    ...state,
    public: {
      ...state.public,
      history: [...state.public.history, ...publicEvents],
    },
  };
}

function nextActiveFrom(
  config: GameConfig,
  state: GameState,
  after: PlayerId,
): PlayerId | undefined {
  const start = config.seats.indexOf(after);
  for (let offset = 1; offset <= config.seats.length; offset += 1) {
    const candidate =
      config.seats[
        (start + offset * state.public.direction + config.seats.length * 2) %
          config.seats.length
      ];
    if (candidate && state.players[candidate]?.status === 'active') {
      return candidate;
    }
  }
  return undefined;
}

function resolveOpeningTurn(
  config: GameConfig,
  initialState: GameState,
): { state: GameState; events: PublicGameEvent[] } {
  let state = initialState;
  let candidate = state.public.turn;
  const events: PublicGameEvent[] = [];
  for (let consumed = 0; consumed <= 1000; consumed += 1) {
    if (!candidate) {
      return { state, events };
    }
    const player = state.players[candidate];
    if (!player || player.status !== 'active') {
      candidate = nextActiveFrom(config, state, candidate) ?? null;
      continue;
    }
    if (player.skipCount <= 0) {
      if (candidate !== state.public.turn) {
        const event: PublicGameEvent = {
          type: 'turnChanged',
          player: candidate,
        };
        events.push(event);
        state = {
          ...state,
          public: {
            ...state.public,
            turn: candidate,
          },
        };
      }
      return { state, events };
    }
    const event: PublicGameEvent = { type: 'passed', player: candidate };
    events.push(event);
    state = {
      ...state,
      public: {
        ...state.public,
        turnCount: state.public.turnCount + 1,
      },
      players: {
        ...state.players,
        [candidate]: {
          ...player,
          skipCount: player.skipCount - 1,
        },
      },
    };
    candidate = nextActiveFrom(config, state, candidate) ?? null;
  }
  throw new Error('Opening skip resolution exceeded the turn safety bound');
}

export function completeGameStart(
  config: GameConfig,
  startedHook: EffectHookResult,
  runtime: RuleRuntime,
): GameTransition {
  let nextState = appendPublicEvents(startedHook.state, startedHook.events);
  const events: EngineEvent[] = [...startedHook.events];
  const active = activePlayers(config, nextState);
  if (active.length <= 1) {
    const finished = finishGame(config, nextState);
    const endHook = executeEffectHook(
      config,
      finished.state,
      { ...runtime, setMemory: startedHook.setMemory },
      'onGameEnd',
      { standings: finished.event.standings },
    );
    events.push(...endHook.events, finished.event);
    nextState = appendPublicEvents(endHook.state, [
      ...endHook.events,
      finished.event,
    ]);
    return {
      state: nextState,
      events,
      rejections: [],
      setMemory: endHook.setMemory,
    };
  }
  const opening = resolveOpeningTurn(config, nextState);
  nextState = appendPublicEvents(opening.state, opening.events);
  events.push(...opening.events);
  return {
    state: nextState,
    events,
    rejections: [],
    setMemory: startedHook.setMemory,
  };
}

export function startGame(
  config: GameConfig,
  runtime: RuleRuntime = noRuleRuntime(),
): GameTransition {
  validateConfig(config);
  const shuffled = shuffle(
    createDeck(engineFeaturesOf(config.ruleChain)),
    seedRng(config.gameSeed),
  );
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
      ruleNotices: [],
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

  if (config.ruleChain.some((entry) => entry.contractVersion === 2)) {
    const preview = executeEffectHook(
      config,
      state,
      runtime,
      'onGameStart',
      undefined,
      undefined,
      { previewChoice: true },
    );
    const requests = preview.choiceRequests ?? [];
    const request = requests[0];
    if (request) {
      const sameRuleRequests = requests.filter(
        (candidate) => candidate.ruleId === request.ruleId,
      );
      return {
        state: {
          ...state,
          public: { ...state.public, phase: 'awaitingChoice' },
          private: {
            ...state.private,
            pendingChoice: {
              ...request,
              hook: 'onGameStart',
              ...(request.simultaneous === true
                ? {
                    simultaneousChoices: sameRuleRequests,
                    submittedChoices: [],
                  }
                : {}),
              continuation: {
                remainingChoices: sameRuleRequests.slice(1),
                remainingRuleIds: config.ruleChain
                  .filter(({ ruleId }) => ruleId !== request.ruleId)
                  .map(({ ruleId }) => ruleId),
                clearRequested: false,
              },
            },
          },
        },
        events: [gameStarted],
        rejections: [],
        setMemory: runtime.setMemory,
      };
    }
  }

  const startedHook = executeEffectHook(config, state, runtime, 'onGameStart');
  const completed = completeGameStart(config, startedHook, runtime);
  return { ...completed, events: [gameStarted, ...completed.events] };
}
