import type {
  GameConfig,
  GameState,
  JsonValue,
  PlayerId,
  PublicGameEvent,
  Standing,
} from '../game/types.js';
import { TITLE_BY_STANDING } from '../game/types.js';

const STANDINGS: Standing[] = [1, 2, 3, 4];

export function activePlayers(
  config: GameConfig,
  state: GameState,
): PlayerId[] {
  return config.seats.filter(
    (player) => state.players[player]?.status === 'active',
  );
}

function nextStanding(state: GameState): Standing {
  const standing = STANDINGS.find(
    (candidate) => !state.public.standingsTaken.includes(candidate),
  );
  if (!standing) {
    throw new Error('No standing is available');
  }
  return standing;
}

export function finishPlayer(
  state: GameState,
  playerId: PlayerId,
): { state: GameState; event: PublicGameEvent } {
  const player = state.players[playerId];
  if (!player) {
    throw new Error(`Missing player state: ${playerId}`);
  }
  const standing = nextStanding(state);
  return {
    state: {
      ...state,
      public: {
        ...state.public,
        standingsTaken: [...state.public.standingsTaken, standing],
      },
      players: {
        ...state.players,
        [playerId]: {
          ...player,
          status: 'finished',
          standing,
        },
      },
    },
    event: {
      type: 'playerFinished',
      player: playerId,
      standing,
      title: TITLE_BY_STANDING[standing],
    },
  };
}

export function finishGame(
  config: GameConfig,
  state: GameState,
): {
  state: GameState;
  event: Extract<PublicGameEvent, { type: 'gameEnded' }>;
} {
  let finishedState = state;
  const remaining = activePlayers(config, state);
  if (remaining.length === 1 && remaining[0]) {
    finishedState = finishPlayer(finishedState, remaining[0]).state;
  }
  const standings = config.seats
    .map((playerId) => {
      const standing = finishedState.players[playerId]?.standing;
      if (!standing) {
        throw new Error(`Player has no final standing: ${playerId}`);
      }
      return {
        player: playerId,
        standing,
        title: TITLE_BY_STANDING[standing],
      };
    })
    .sort((left, right) => left.standing - right.standing);
  return {
    state: {
      ...finishedState,
      public: {
        ...finishedState.public,
        phase: 'finished',
        turn: null,
      },
    },
    event: { type: 'gameEnded', standings },
  };
}

export function forceFinishByHandCount(
  config: GameConfig,
  state: GameState,
): { state: GameState; events: PublicGameEvent[] } {
  let nextState = state;
  const seatIndex = new Map(
    config.seats.map((playerId, index) => [playerId, index]),
  );
  const events: PublicGameEvent[] = [];
  const remaining = activePlayers(config, state).sort(
    (left, right) =>
      (state.players[left]?.hand.length ?? 0) -
        (state.players[right]?.hand.length ?? 0) ||
      (seatIndex.get(left) ?? 0) - (seatIndex.get(right) ?? 0),
  );
  for (const playerId of remaining) {
    const finished = finishPlayer(nextState, playerId);
    nextState = finished.state;
    events.push(finished.event);
  }
  return { state: nextState, events };
}

function nearestAvailableStanding(
  desired: Standing,
  used: ReadonlySet<Standing>,
): Standing {
  if (!used.has(desired)) {
    return desired;
  }
  for (let candidate = desired + 1; candidate <= 4; candidate += 1) {
    if (!used.has(candidate as Standing)) {
      return candidate as Standing;
    }
  }
  for (let candidate = desired - 1; candidate >= 1; candidate -= 1) {
    if (!used.has(candidate as Standing)) {
      return candidate as Standing;
    }
  }
  throw new Error('No standing slot is available');
}

export function forceStanding(
  state: GameState,
  playerId: PlayerId,
  desired: Standing,
): {
  state: GameState;
  events: PublicGameEvent[];
  detail: JsonValue;
} {
  const player = state.players[playerId];
  if (!player) {
    return {
      state,
      events: [],
      detail: { applied: false, reason: 'unknown-player' },
    };
  }
  const used = new Set(
    Object.values(state.players)
      .filter((candidate) => candidate.id !== playerId)
      .flatMap((candidate) =>
        candidate.standing === undefined ? [] : [candidate.standing],
      ),
  );
  const assigned = nearestAvailableStanding(desired, used);
  const wasActive = player.status === 'active';
  const retiredCards = wasActive ? player.hand : [];
  const nextPlayer = {
    ...player,
    ...(wasActive ? { hand: [], status: 'retired' as const } : {}),
    standing: assigned,
  };
  const events: PublicGameEvent[] = wasActive
    ? [
        {
          type: 'playerRetired',
          player: playerId,
          cardCount: retiredCards.length,
          standing: assigned,
        },
      ]
    : [];
  return {
    state: {
      ...state,
      public: {
        ...state.public,
        standingsTaken: [
          ...new Set(
            Object.values({
              ...state.players,
              [playerId]: nextPlayer,
            }).flatMap((candidate) =>
              candidate.standing === undefined ? [] : [candidate.standing],
            ),
          ),
        ].sort(),
      },
      private: {
        ...state.private,
        excluded: [...state.private.excluded, ...retiredCards],
      },
      players: {
        ...state.players,
        [playerId]: nextPlayer,
      },
    },
    events,
    detail: {
      applied: true,
      requestedStanding: desired,
      assignedStanding: assigned,
    },
  };
}
