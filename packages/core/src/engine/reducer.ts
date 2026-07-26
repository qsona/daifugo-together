import type { Card } from '../cards/card.js';
import type {
  ActionRejectionCode,
  GameAction,
  GameConfig,
  GameState,
  GameTransition,
  PlayerId,
  PublicGameEvent,
  Standing,
} from '../game/types.js';
import { TITLE_BY_STANDING } from '../game/types.js';
import { evaluateCandidates } from '../play/candidates.js';
import { BASE_STRENGTH_ORDER } from '../play/strength.js';
import { interpretPlay } from '../play/play.js';
import { buildRuleContext } from '../rules/context.js';
import { noRuleRuntime, type RuleRuntime } from '../rules/chain.js';

function reject(
  state: GameState,
  player: PlayerId,
  code: ActionRejectionCode,
  reasonKey?: string,
): GameTransition {
  return {
    state,
    events: [],
    rejections: [
      {
        player,
        code,
        ...(reasonKey === undefined ? {} : { reasonKey }),
      },
    ],
  };
}

function activePlayers(config: GameConfig, state: GameState): PlayerId[] {
  return config.seats.filter(
    (player) => state.players[player]?.status === 'active',
  );
}

function nextActivePlayer(
  config: GameConfig,
  state: GameState,
  after: PlayerId,
): PlayerId {
  const startIndex = config.seats.indexOf(after);
  for (let offset = 1; offset <= config.seats.length; offset += 1) {
    const index =
      (startIndex + offset * state.public.direction + config.seats.length * 2) %
      config.seats.length;
    const candidate = config.seats[index];
    if (candidate && state.players[candidate]?.status === 'active') {
      return candidate;
    }
  }
  throw new Error('No active player is available');
}

function appendEvents(state: GameState, events: PublicGameEvent[]): GameState {
  return {
    ...state,
    public: {
      ...state.public,
      history: [...state.public.history, ...events],
    },
  };
}

function allOthersPassed(state: GameState, active: PlayerId[]): boolean {
  const lastPlayer = state.public.field.current?.by;
  if (!lastPlayer) {
    return false;
  }
  const expected = active.filter((player) => player !== lastPlayer);
  return expected.every((player) =>
    state.public.field.passedSinceLastPlay.includes(player),
  );
}

function clearField(
  config: GameConfig,
  state: GameState,
  reason: 'allPassed' | 'rule' = 'allPassed',
): { state: GameState; events: PublicGameEvent[] } {
  const current = state.public.field.current;
  if (!current) {
    return { state, events: [] };
  }
  const nextLeader =
    state.players[current.by]?.status === 'active'
      ? current.by
      : nextActivePlayer(config, state, current.by);
  const events: PublicGameEvent[] = [
    { type: 'fieldCleared', reason, nextLeader },
    { type: 'turnChanged', player: nextLeader },
  ];
  return {
    state: appendEvents(
      {
        ...state,
        public: {
          ...state.public,
          turn: nextLeader,
          field: { passedSinceLastPlay: [] },
          discard: [...state.public.discard, ...current.play.cards],
        },
      },
      events,
    ),
    events,
  };
}

function applyAfterPlayEffects(
  config: GameConfig,
  state: GameState,
  play: ReturnType<typeof interpretPlay> & { ok: true },
  runtime: RuleRuntime,
): {
  state: GameState;
  events: PublicGameEvent[];
  clearRequested: boolean;
} {
  const context = buildRuleContext(config, state, BASE_STRENGTH_ORDER, runtime);
  const emissions = runtime.port.collectEffects(
    'afterPlay',
    config.ruleChain,
    context,
    play.play,
  );
  const firedRules = new Set(state.public.firedRules);
  const events: PublicGameEvent[] = [];
  let clearRequested = false;
  for (const emission of emissions) {
    const nonAnnounce = emission.effects.filter(
      (effect) => effect.type !== 'announce',
    );
    if (nonAnnounce.length > 0) {
      firedRules.add(emission.ruleId);
    }
    for (const effect of emission.effects) {
      if (effect.type === 'clearField') {
        clearRequested = true;
      }
      if (effect.type === 'announce') {
        firedRules.add(emission.ruleId);
        events.push({
          type: 'ruleFired',
          ruleId: emission.ruleId,
          messageKey: effect.messageKey,
          ...(effect.params === undefined ? {} : { params: effect.params }),
        });
      }
    }
  }
  return {
    state: {
      ...state,
      public: {
        ...state.public,
        firedRules: [...firedRules],
      },
    },
    events,
    clearRequested,
  };
}

function reducePass(
  config: GameConfig,
  state: GameState,
  action: Extract<GameAction, { type: 'pass' }>,
): GameTransition {
  if (!state.public.field.current) {
    return reject(state, action.player, 'PASS_ON_LEAD');
  }

  const passed = {
    ...state,
    public: {
      ...state.public,
      field: {
        ...state.public.field,
        passedSinceLastPlay: [
          ...new Set([
            ...state.public.field.passedSinceLastPlay,
            action.player,
          ]),
        ],
      },
      turnCount: state.public.turnCount + 1,
    },
  };
  const passEvent: PublicGameEvent = {
    type: 'passed',
    player: action.player,
  };
  const withPassEvent = appendEvents(passed, [passEvent]);
  if (allOthersPassed(withPassEvent, activePlayers(config, withPassEvent))) {
    const cleared = clearField(config, withPassEvent);
    return {
      state: cleared.state,
      events: [passEvent, ...cleared.events],
      rejections: [],
    };
  }

  const next = nextActivePlayer(config, withPassEvent, action.player);
  const turnEvent: PublicGameEvent = { type: 'turnChanged', player: next };
  return {
    state: appendEvents(
      {
        ...withPassEvent,
        public: { ...withPassEvent.public, turn: next },
      },
      [turnEvent],
    ),
    events: [passEvent, turnEvent],
    rejections: [],
  };
}

function removeCards(hand: readonly Card[], selected: readonly Card[]): Card[] {
  const selectedIds = new Set(selected.map((card) => card.id));
  return hand.filter((card) => !selectedIds.has(card.id));
}

const STANDINGS: Standing[] = [1, 2, 3, 4];

function nextStanding(state: GameState): Standing {
  const standing = STANDINGS.find(
    (candidate) => !state.public.standingsTaken.includes(candidate),
  );
  if (!standing) {
    throw new Error('No standing is available');
  }
  return standing;
}

function finishPlayer(
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

function finishGame(
  config: GameConfig,
  state: GameState,
): { state: GameState; event: PublicGameEvent } {
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

function reducePlay(
  config: GameConfig,
  state: GameState,
  action: Extract<GameAction, { type: 'play' }>,
  runtime: RuleRuntime,
): GameTransition {
  const player = state.players[action.player];
  if (!player) {
    return reject(state, action.player, 'CARD_NOT_IN_HAND');
  }
  const interpreted = interpretPlay(player.hand, action.cards);
  if (!interpreted.ok) {
    return reject(state, action.player, interpreted.code);
  }

  const baseFieldExists = state.public.field.current !== undefined;
  const evaluated = evaluateCandidates(
    config,
    state,
    [interpreted.play],
    runtime,
  );
  if (evaluated.plays.length === 0) {
    const baseEvaluation = evaluateCandidates(
      { ...config, ruleChain: [] },
      state,
      [interpreted.play],
      noRuleRuntime(),
    );
    if (baseEvaluation.plays.length === 0 && baseFieldExists) {
      return reject(state, action.player, 'TOO_WEAK');
    }
    const finalLegality = evaluated.results[0];
    return reject(
      state,
      action.player,
      'FORBIDDEN_BY_RULE',
      finalLegality?.legal === false ? finalLegality.reasonKey : undefined,
    );
  }

  const priorFieldCards = state.public.field.current?.play.cards ?? [];
  const playedEvent: PublicGameEvent = {
    type: 'played',
    player: action.player,
    play: interpreted.play,
  };
  let nextState: GameState = {
    ...state,
    public: {
      ...state.public,
      field: {
        current: { play: interpreted.play, by: action.player },
        passedSinceLastPlay: [],
      },
      discard: [...state.public.discard, ...priorFieldCards],
      firedRules: [
        ...new Set([...state.public.firedRules, ...evaluated.influenced]),
      ],
      turnCount: state.public.turnCount + 1,
    },
    players: {
      ...state.players,
      [action.player]: {
        ...player,
        hand: removeCards(player.hand, interpreted.play.cards),
      },
    },
  };
  const events: PublicGameEvent[] = [playedEvent];
  if (nextState.players[action.player]?.hand.length === 0) {
    const finished = finishPlayer(nextState, action.player);
    nextState = finished.state;
    events.push(finished.event);
  }

  const effects = applyAfterPlayEffects(
    config,
    nextState,
    interpreted,
    runtime,
  );
  nextState = effects.state;
  events.push(...effects.events);

  if (activePlayers(config, nextState).length <= 1) {
    const finished = finishGame(config, nextState);
    events.push(finished.event);
    return {
      state: appendEvents(finished.state, events),
      events,
      rejections: [],
    };
  }

  if (effects.clearRequested) {
    const cleared = clearField(config, appendEvents(nextState, events), 'rule');
    return {
      state: cleared.state,
      events: [...events, ...cleared.events],
      rejections: [],
    };
  }

  const next = nextActivePlayer(config, nextState, action.player);
  const turnEvent: PublicGameEvent = { type: 'turnChanged', player: next };
  events.push(turnEvent);
  nextState = {
    ...nextState,
    public: { ...nextState.public, turn: next },
  };
  return {
    state: appendEvents(nextState, events),
    events,
    rejections: [],
  };
}

export function reduceGame(
  config: GameConfig,
  state: GameState,
  action: GameAction,
  runtime: RuleRuntime = noRuleRuntime(),
): GameTransition {
  if (
    state.public.phase !== 'awaitingPlay' ||
    state.public.turn !== action.player
  ) {
    return reject(state, action.player, 'NOT_YOUR_TURN');
  }
  return action.type === 'pass'
    ? reducePass(config, state, action)
    : reducePlay(config, state, action, runtime);
}
