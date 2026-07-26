import type { Card } from '../cards/card.js';
import type {
  ActionRejectionCode,
  EngineEvent,
  GameAction,
  GameConfig,
  GameState,
  GameTransition,
  PlayerId,
  PublicGameEvent,
} from '../game/types.js';
import { evaluateCandidates, generateCandidates } from '../play/candidates.js';
import { interpretPlay, samePlay } from '../play/play.js';
import { noRuleRuntime, type RuleRuntime } from '../rules/chain.js';
import { executeEffectHook } from './effects.js';
import {
  activePlayers,
  finishGame,
  finishPlayer,
  forceFinishByHandCount,
} from './standing.js';

const TURN_LIMIT = 1000;

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

function appendEvents(state: GameState, events: EngineEvent[]): GameState {
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

function finishWithHook(
  config: GameConfig,
  state: GameState,
  runtime: RuleRuntime,
): {
  state: GameState;
  events: EngineEvent[];
  setMemory: RuleRuntime['setMemory'];
} {
  const finished = finishGame(config, state);
  const hook = executeEffectHook(config, finished.state, runtime, 'onGameEnd', {
    standings: finished.event.standings,
  });
  return {
    state: hook.state,
    events: [...hook.events, finished.event],
    setMemory: hook.setMemory,
  };
}

function finishForTurnLimit(
  config: GameConfig,
  state: GameState,
  runtime: RuleRuntime,
): {
  state: GameState;
  events: EngineEvent[];
  setMemory: RuleRuntime['setMemory'];
} {
  const forced = forceFinishByHandCount(config, state);
  const failsafe: PublicGameEvent = {
    type: 'failsafe',
    reason: 'turnLimit',
    relatedRuleIds: config.ruleChain.map((entry) => entry.ruleId),
  };
  const beforeEnd: EngineEvent[] = [failsafe, ...forced.events];
  const finished = finishWithHook(
    config,
    appendEvents(forced.state, beforeEnd),
    runtime,
  );
  return {
    state: appendEvents(finished.state, finished.events),
    events: [...beforeEnd, ...finished.events],
    setMemory: finished.setMemory,
  };
}

function resolveNextTurn(
  config: GameConfig,
  initialState: GameState,
  firstCandidate: PlayerId,
): {
  state: GameState;
  events: PublicGameEvent[];
  needsFieldClear: boolean;
} {
  let state = initialState;
  let candidate = firstCandidate;
  const events: PublicGameEvent[] = [];
  for (let consumed = 0; consumed <= 1000; consumed += 1) {
    const player = state.players[candidate];
    if (!player || player.status !== 'active') {
      candidate = nextActivePlayer(config, state, candidate);
      continue;
    }
    if (player.skipCount <= 0) {
      const turnEvent: PublicGameEvent = {
        type: 'turnChanged',
        player: candidate,
      };
      return {
        state: {
          ...state,
          public: { ...state.public, turn: candidate },
        },
        events: [...events, turnEvent],
        needsFieldClear: false,
      };
    }
    const passedSinceLastPlay = state.public.field.current
      ? [...new Set([...state.public.field.passedSinceLastPlay, candidate])]
      : state.public.field.passedSinceLastPlay;
    state = {
      ...state,
      public: {
        ...state.public,
        field: {
          ...state.public.field,
          passedSinceLastPlay,
        },
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
    events.push({ type: 'passed', player: candidate });
    if (
      state.public.field.current &&
      allOthersPassed(state, activePlayers(config, state))
    ) {
      return { state, events, needsFieldClear: true };
    }
    candidate = nextActivePlayer(config, state, candidate);
  }
  throw new Error('Skip resolution exceeded the turn safety bound');
}

function clearFieldWithHook(
  config: GameConfig,
  state: GameState,
  runtime: RuleRuntime,
  reason: 'allPassed' | 'rule',
): {
  state: GameState;
  events: EngineEvent[];
  setMemory: RuleRuntime['setMemory'];
} {
  const cleared = clearField(config, state, reason);
  if (cleared.events.length === 0) {
    return { state, events: [], setMemory: runtime.setMemory };
  }
  const hook = executeEffectHook(
    config,
    cleared.state,
    runtime,
    'afterFieldClear',
  );
  if (activePlayers(config, hook.state).length <= 1) {
    return {
      state: appendEvents(hook.state, hook.events),
      events: [...cleared.events, ...hook.events],
      setMemory: hook.setMemory,
    };
  }
  const current = hook.state.public.turn;
  const firstLeader =
    current && hook.state.players[current]?.status === 'active'
      ? current
      : current
        ? nextActivePlayer(config, hook.state, current)
        : activePlayers(config, hook.state)[0];
  if (!firstLeader) {
    return {
      state: hook.state,
      events: [...cleared.events, ...hook.events],
      setMemory: hook.setMemory,
    };
  }
  const turn = resolveNextTurn(config, hook.state, firstLeader);
  return {
    state: appendEvents(turn.state, [...hook.events, ...turn.events]),
    events: [...cleared.events, ...hook.events, ...turn.events],
    setMemory: hook.setMemory,
  };
}

function advanceTurn(
  config: GameConfig,
  state: GameState,
  after: PlayerId,
  runtime: RuleRuntime,
): {
  state: GameState;
  events: EngineEvent[];
  setMemory: RuleRuntime['setMemory'];
} {
  const first = nextActivePlayer(config, state, after);
  const turn = resolveNextTurn(config, state, first);
  const withSkipEvents = appendEvents(turn.state, turn.events);
  if (!turn.needsFieldClear) {
    return {
      state: withSkipEvents,
      events: turn.events,
      setMemory: runtime.setMemory,
    };
  }
  const cleared = clearFieldWithHook(
    config,
    withSkipEvents,
    runtime,
    'allPassed',
  );
  return {
    state: cleared.state,
    events: [...turn.events, ...cleared.events],
    setMemory: cleared.setMemory,
  };
}

function reducePass(
  config: GameConfig,
  state: GameState,
  action: Extract<GameAction, { type: 'pass' }>,
  runtime: RuleRuntime,
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
    const cleared = clearFieldWithHook(
      config,
      withPassEvent,
      runtime,
      'allPassed',
    );
    if (cleared.state.public.turnCount > TURN_LIMIT) {
      const finished = finishForTurnLimit(config, cleared.state, {
        ...runtime,
        setMemory: cleared.setMemory,
      });
      return {
        state: finished.state,
        events: [passEvent, ...cleared.events, ...finished.events],
        rejections: [],
        setMemory: finished.setMemory,
      };
    }
    if (activePlayers(config, cleared.state).length <= 1) {
      const finished = finishWithHook(config, cleared.state, {
        ...runtime,
        setMemory: cleared.setMemory,
      });
      const events = [passEvent, ...cleared.events, ...finished.events];
      return {
        state: appendEvents(finished.state, finished.events),
        events,
        rejections: [],
        setMemory: finished.setMemory,
      };
    }
    return {
      state: cleared.state,
      events: [passEvent, ...cleared.events],
      rejections: [],
      setMemory: cleared.setMemory,
    };
  }

  const advanced = advanceTurn(config, withPassEvent, action.player, runtime);
  if (advanced.state.public.turnCount > TURN_LIMIT) {
    const finished = finishForTurnLimit(config, advanced.state, {
      ...runtime,
      setMemory: advanced.setMemory,
    });
    return {
      state: finished.state,
      events: [passEvent, ...advanced.events, ...finished.events],
      rejections: [],
      setMemory: finished.setMemory,
    };
  }
  if (activePlayers(config, advanced.state).length <= 1) {
    const finished = finishWithHook(config, advanced.state, {
      ...runtime,
      setMemory: advanced.setMemory,
    });
    return {
      state: appendEvents(finished.state, finished.events),
      events: [passEvent, ...advanced.events, ...finished.events],
      rejections: [],
      setMemory: finished.setMemory,
    };
  }
  return {
    state: advanced.state,
    events: [passEvent, ...advanced.events],
    rejections: [],
    setMemory: advanced.setMemory,
  };
}

function removeCards(hand: readonly Card[], selected: readonly Card[]): Card[] {
  const selectedIds = new Set(selected.map((card) => card.id));
  return hand.filter((card) => !selectedIds.has(card.id));
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
  const candidates = generateCandidates(player.hand);
  const selectedIndex = candidates.findIndex((candidate) =>
    samePlay(candidate, interpreted.play),
  );
  if (selectedIndex < 0) {
    return reject(state, action.player, 'INVALID_PLAY_SHAPE');
  }
  const evaluated = evaluateCandidates(config, state, candidates, runtime, {
    authoritative: true,
  });
  if (
    !evaluated.plays.some((candidate) => samePlay(candidate, interpreted.play))
  ) {
    if (
      evaluated.baseResults[selectedIndex]?.legal === false &&
      baseFieldExists
    ) {
      return reject(state, action.player, 'TOO_WEAK');
    }
    const finalLegality = evaluated.results[selectedIndex];
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
    ...evaluated.state,
    public: {
      ...evaluated.state.public,
      field: {
        current: { play: interpreted.play, by: action.player },
        passedSinceLastPlay: [],
      },
      discard: [...evaluated.state.public.discard, ...priorFieldCards],
      firedRules: [
        ...new Set([
          ...evaluated.state.public.firedRules,
          ...evaluated.influenced,
        ]),
      ],
      turnCount: evaluated.state.public.turnCount + 1,
    },
    players: {
      ...evaluated.state.players,
      [action.player]: {
        ...player,
        hand: removeCards(player.hand, interpreted.play.cards),
      },
    },
  };
  const events: EngineEvent[] = [
    ...(evaluated.failsafeActivated
      ? [
          {
            type: 'failsafe' as const,
            reason: 'leadNoLegalMove' as const,
            relatedRuleIds: evaluated.influenced,
          },
        ]
      : []),
    playedEvent,
  ];
  if (nextState.players[action.player]?.hand.length === 0) {
    const finished = finishPlayer(nextState, action.player);
    nextState = finished.state;
    events.push(finished.event);
  }

  const effects = executeEffectHook(
    config,
    nextState,
    runtime,
    'afterPlay',
    interpreted.play,
  );
  nextState = effects.state;
  events.push(...effects.events);

  if (nextState.public.turnCount > TURN_LIMIT) {
    const finished = finishForTurnLimit(
      config,
      appendEvents(nextState, events),
      {
        ...runtime,
        setMemory: effects.setMemory,
      },
    );
    return {
      state: finished.state,
      events: [...events, ...finished.events],
      rejections: [],
      setMemory: finished.setMemory,
    };
  }

  if (activePlayers(config, nextState).length <= 1) {
    const finished = finishWithHook(config, appendEvents(nextState, events), {
      ...runtime,
      setMemory: effects.setMemory,
    });
    events.push(...finished.events);
    return {
      state: appendEvents(finished.state, finished.events),
      events,
      rejections: [],
      setMemory: finished.setMemory,
    };
  }

  if (effects.clearRequested) {
    const cleared = clearFieldWithHook(
      config,
      appendEvents(nextState, events),
      {
        ...runtime,
        setMemory: effects.setMemory,
      },
      'rule',
    );
    if (activePlayers(config, cleared.state).length <= 1) {
      const finished = finishWithHook(config, cleared.state, {
        ...runtime,
        setMemory: cleared.setMemory,
      });
      const finalEvents = [...events, ...cleared.events, ...finished.events];
      return {
        state: appendEvents(finished.state, finished.events),
        events: finalEvents,
        rejections: [],
        setMemory: finished.setMemory,
      };
    }
    return {
      state: cleared.state,
      events: [...events, ...cleared.events],
      rejections: [],
      setMemory: cleared.setMemory,
    };
  }

  const advanced = advanceTurn(
    config,
    appendEvents(nextState, events),
    action.player,
    {
      ...runtime,
      setMemory: effects.setMemory,
    },
  );
  events.push(...advanced.events);
  if (advanced.state.public.turnCount > TURN_LIMIT) {
    const finished = finishForTurnLimit(config, advanced.state, {
      ...runtime,
      setMemory: advanced.setMemory,
    });
    return {
      state: finished.state,
      events: [...events, ...finished.events],
      rejections: [],
      setMemory: finished.setMemory,
    };
  }
  if (activePlayers(config, advanced.state).length <= 1) {
    const finished = finishWithHook(config, advanced.state, {
      ...runtime,
      setMemory: advanced.setMemory,
    });
    return {
      state: appendEvents(finished.state, finished.events),
      events: [...events, ...finished.events],
      rejections: [],
      setMemory: finished.setMemory,
    };
  }
  return {
    state: advanced.state,
    events,
    rejections: [],
    setMemory: advanced.setMemory,
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
    ? reducePass(config, state, action, runtime)
    : reducePlay(config, state, action, runtime);
}
