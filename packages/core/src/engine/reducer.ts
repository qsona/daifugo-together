import type { Card } from '../cards/card.js';
import type {
  ActionRejectionCode,
  EngineEvent,
  GameAction,
  GameConfig,
  GameState,
  GameTransition,
  PendingChoiceRequest,
  PlayerId,
  PublicGameEvent,
  SubmittedRuleChoice,
} from '../game/types.js';
import { completeGameStart } from '../game/start-game.js';
import { evaluateCandidates, generateCandidates } from '../play/candidates.js';
import {
  matchPlayCandidates,
  PLAY_KIND_ORDER,
  type PlayCandidateMatch,
} from '../play/play.js';
import { rankPosition, type StrengthOrder } from '../play/strength.js';
import { noRuleRuntime, type RuleRuntime } from '../rules/chain.js';
import { engineFeaturesOf, type RuleInput } from '../rules/contract.js';
import { executeEffectHook, type EffectHookResult } from './effects.js';
import {
  activePlayers,
  finishGame,
  finishPlayer,
  forceFinishByHandCount,
} from './standing.js';
import {
  advanceBombThrowMiniGame,
  applyBombThrowCommand,
  bombThrowComplete,
  bombThrowResult,
} from '../minigame/bomb-throw.js';
import {
  advanceBinaryQuizRace,
  answerBinaryQuiz,
  binaryQuizRaceComplete,
  binaryQuizRaceResult,
  canAnswerBinaryQuiz,
  setBinaryQuizQuestion,
} from '../minigame/binary-quiz-race.js';

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

/**
 * 解釈の決定順: kind 優先順 (single < set < sequence) を先に適用し、
 * 同じ kind では実効 StrengthOrder 上で最強の repRank を先頭にする。
 * 最後はカード ID 列の辞書順で、生成順に依存しない決定的な順序にする。
 */
function sortMatchesPreferredFirst(
  matches: readonly PlayCandidateMatch[],
  strength: StrengthOrder,
): PlayCandidateMatch[] {
  return [...matches].sort((left, right) => {
    const byKind =
      PLAY_KIND_ORDER[left.play.kind] - PLAY_KIND_ORDER[right.play.kind];
    if (byKind !== 0) {
      return byKind;
    }
    const byStrength =
      rankPosition(right.play.repRank, strength) -
      rankPosition(left.play.repRank, strength);
    if (byStrength !== 0) {
      return byStrength;
    }
    const leftIds = left.play.cards.map((card) => card.id).join(',');
    const rightIds = right.play.cards.map((card) => card.id).join(',');
    return leftIds.localeCompare(rightIds);
  });
}

function completeAfterPlay(
  config: GameConfig,
  initialState: GameState,
  player: PlayerId,
  initialEvents: EngineEvent[],
  effects: EffectHookResult,
  runtime: RuleRuntime,
): GameTransition {
  const events = [...initialEvents];
  const nextState = effects.state;
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
    player,
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
  const baseFieldExists = state.public.field.current !== undefined;
  const candidates = generateCandidates(
    player.hand,
    engineFeaturesOf(config.ruleChain),
  );
  const matched = matchPlayCandidates(
    player.hand,
    action.cards,
    candidates,
    action.kind,
  );
  if (!matched.ok) {
    return reject(state, action.player, matched.code);
  }
  const evaluated = evaluateCandidates(config, state, candidates, runtime, {
    authoritative: true,
  });
  const legalMatches = matched.matches.filter(
    (match) => evaluated.results[match.index]?.legal === true,
  );
  if (legalMatches.length === 0) {
    if (
      baseFieldExists &&
      matched.matches.every(
        (match) => evaluated.baseResults[match.index]?.legal === false,
      )
    ) {
      return reject(state, action.player, 'TOO_WEAK');
    }
    const ordered = sortMatchesPreferredFirst(
      matched.matches,
      evaluated.strength,
    );
    const finalLegality = evaluated.results[ordered[0]!.index];
    return reject(
      state,
      action.player,
      'FORBIDDEN_BY_RULE',
      finalLegality?.legal === false ? finalLegality.reasonKey : undefined,
    );
  }
  const interpretedPlay = sortMatchesPreferredFirst(
    legalMatches,
    evaluated.strength,
  )[0]!.play;

  const priorFieldCards = state.public.field.current?.play.cards ?? [];
  const playedEvent: PublicGameEvent = {
    type: 'played',
    player: action.player,
    play: interpretedPlay,
  };
  let nextState: GameState = {
    ...evaluated.state,
    public: {
      ...evaluated.state.public,
      field: {
        current: { play: interpretedPlay, by: action.player },
        passedSinceLastPlay: [],
      },
      discard: [...evaluated.state.public.discard, ...priorFieldCards],
      firedRules: evaluated.state.public.firedRules,
      turnCount: evaluated.state.public.turnCount + 1,
    },
    players: {
      ...evaluated.state.players,
      [action.player]: {
        ...player,
        hand: removeCards(player.hand, interpretedPlay.cards),
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

  if (config.ruleChain.some((entry) => entry.contractVersion === 2)) {
    const preview = executeEffectHook(
      config,
      nextState,
      runtime,
      'afterPlay',
      interpretedPlay,
      evaluated.strength,
      { previewChoice: true },
    );
    const requests = preview.choiceRequests ?? [];
    const request = requests[0];
    if (request) {
      const sameRuleRequests = requests.filter(
        (candidate) => candidate.ruleId === request.ruleId,
      );
      const withEvents = appendEvents(nextState, events);
      return {
        state: {
          ...withEvents,
          public: {
            ...withEvents.public,
            phase: 'awaitingChoice',
          },
          private: {
            ...withEvents.private,
            pendingChoice: {
              ...request,
              play: interpretedPlay,
              strength: evaluated.strength,
              playedBy: action.player,
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
        events,
        rejections: [],
        setMemory: runtime.setMemory,
      };
    }
  }

  const effects = executeEffectHook(
    config,
    nextState,
    runtime,
    'afterPlay',
    interpretedPlay,
    evaluated.strength,
  );
  nextState = effects.state;
  events.push(...effects.events);
  return completeAfterPlay(
    config,
    nextState,
    action.player,
    events,
    effects,
    runtime,
  );
}

function awaitGameStartChoice(
  state: GameState,
  request: PendingChoiceRequest,
  continuation: NonNullable<
    NonNullable<GameState['private']['pendingChoice']>['continuation']
  >,
  events: EngineEvent[],
  setMemory: NonNullable<GameTransition['setMemory']>,
): GameTransition {
  const withEvents = appendEvents(state, events);
  return {
    state: {
      ...withEvents,
      public: { ...withEvents.public, phase: 'awaitingChoice' },
      private: {
        ...withEvents.private,
        pendingChoice: {
          ...request,
          hook: 'onGameStart',
          continuation,
        },
      },
    },
    events,
    rejections: [],
    setMemory,
  };
}

function reduceGameStartRuleInput(
  config: GameConfig,
  state: GameState,
  pending: NonNullable<GameState['private']['pendingChoice']>,
  inputValue: RuleInput,
  runtime: RuleRuntime,
): GameTransition {
  const continuation = pending.continuation ?? {
    remainingRuleIds: [],
    remainingChoices: [],
    clearRequested: false,
  };
  const currentConfig: GameConfig = {
    ...config,
    ruleChain: config.ruleChain.filter(
      ({ ruleId }) => ruleId === pending.ruleId,
    ),
  };
  const currentEffects = executeEffectHook(
    currentConfig,
    state,
    runtime,
    'onGameStart',
    undefined,
    undefined,
    {
      previewChoice: true,
      input: { ruleId: pending.ruleId, value: inputValue },
    },
  );
  const remainingChoices = continuation.remainingChoices ?? [];
  const dynamicRequest = currentEffects.choiceRequests?.[0];
  if (dynamicRequest) {
    return awaitGameStartChoice(
      currentEffects.state,
      dynamicRequest,
      {
        remainingChoices: [
          ...(currentEffects.choiceRequests ?? []).slice(1),
          ...remainingChoices,
        ],
        remainingRuleIds: continuation.remainingRuleIds,
        clearRequested: false,
      },
      currentEffects.events,
      currentEffects.setMemory,
    );
  }
  const nextSameRuleChoice = remainingChoices[0];
  if (nextSameRuleChoice) {
    return awaitGameStartChoice(
      currentEffects.state,
      nextSameRuleChoice,
      {
        remainingChoices: remainingChoices.slice(1),
        remainingRuleIds: continuation.remainingRuleIds,
        clearRequested: false,
      },
      currentEffects.events,
      currentEffects.setMemory,
    );
  }

  const remainingConfig: GameConfig = {
    ...config,
    ruleChain: config.ruleChain.filter(({ ruleId }) =>
      continuation.remainingRuleIds.includes(ruleId),
    ),
  };
  const continuedRuntime: RuleRuntime = {
    ...runtime,
    setMemory: currentEffects.setMemory,
  };
  const preview = executeEffectHook(
    remainingConfig,
    currentEffects.state,
    continuedRuntime,
    'onGameStart',
    undefined,
    undefined,
    { previewChoice: true },
  );
  const nextRequest = preview.choiceRequests?.[0];
  if (nextRequest) {
    return awaitGameStartChoice(
      currentEffects.state,
      nextRequest,
      {
        remainingChoices: (preview.choiceRequests ?? []).filter(
          (candidate, index) =>
            index > 0 && candidate.ruleId === nextRequest.ruleId,
        ),
        remainingRuleIds: continuation.remainingRuleIds.filter(
          (ruleId) => ruleId !== nextRequest.ruleId,
        ),
        clearRequested: false,
      },
      currentEffects.events,
      currentEffects.setMemory,
    );
  }

  const remainingEffects = executeEffectHook(
    remainingConfig,
    currentEffects.state,
    continuedRuntime,
    'onGameStart',
  );
  return completeGameStart(
    config,
    {
      ...remainingEffects,
      events: [...currentEffects.events, ...remainingEffects.events],
    },
    { ...runtime, setMemory: remainingEffects.setMemory },
  );
}

function reduceSingleRuleInput(
  config: GameConfig,
  state: GameState,
  action: Extract<GameAction, { type: 'ruleInput' }>,
  runtime: RuleRuntime,
): GameTransition {
  const pending = state.private.pendingChoice;
  if (
    state.public.phase !== 'awaitingChoice' ||
    !pending ||
    pending.player !== action.player ||
    pending.choiceId !== action.choiceId
  ) {
    return reject(state, action.player, 'NO_PENDING_CHOICE');
  }
  const pendingKind = pending.kind ?? 'cards';
  const validCards =
    pendingKind === 'cards' &&
    'cardIds' in action &&
    action.cardIds !== undefined &&
    action.cardIds.length === pending.count &&
    new Set(action.cardIds).size === action.cardIds.length &&
    action.cardIds.every((cardId) =>
      (pending.optionCardIds ?? []).includes(cardId),
    );
  const validPlayer =
    pendingKind === 'player' &&
    'playerId' in action &&
    action.playerId !== undefined &&
    (pending.optionPlayerIds ?? []).includes(action.playerId);
  const canonicalBombResult =
    pending.miniGameState?.kind === 'bomb_throw_15'
      ? bombThrowResult(pending.miniGameState)
      : null;
  const canonicalQuizResult =
    pending.miniGameState?.kind === 'binary_quiz_race'
      ? binaryQuizRaceResult(pending.miniGameState)
      : null;
  const validMiniGame =
    pendingKind === 'miniGame' &&
    pending.miniGameState?.kind === 'bomb_throw_15' &&
    bombThrowComplete(pending.miniGameState) &&
    'miniGameId' in action &&
    action.miniGameId === pending.miniGameState.id;
  const validMultiMiniGame =
    pendingKind === 'miniGame' &&
    pending.miniGameState?.kind === 'binary_quiz_race' &&
    binaryQuizRaceComplete(pending.miniGameState) &&
    'miniGameId' in action &&
    'winnerPlayerIds' in action &&
    action.miniGameId === pending.miniGameState.id;
  if (!validCards && !validPlayer && !validMiniGame && !validMultiMiniGame) {
    return reject(state, action.player, 'INVALID_RULE_CHOICE');
  }
  const inputValue: RuleInput =
    validMiniGame && canonicalBombResult
      ? {
          kind: 'miniGameResult',
          choiceId: pending.choiceId,
          ...canonicalBombResult,
        }
      : validMultiMiniGame && canonicalQuizResult
        ? {
            kind: 'miniGameMultiResult',
            choiceId: pending.choiceId,
            ...canonicalQuizResult,
          }
        : validPlayer
          ? {
              kind: 'player' as const,
              choiceId: pending.choiceId,
              playerId: action.playerId,
            }
          : {
              kind: 'cards' as const,
              choiceId: pending.choiceId,
              cardIds: [...(('cardIds' in action && action.cardIds) || [])],
            };
  const privateState = {
    excluded: state.private.excluded,
    memory: state.private.memory,
    rng: state.private.rng,
    hookCalls: state.private.hookCalls,
    ruleNotices: state.private.ruleNotices ?? [],
  };
  const resumedState: GameState = {
    ...state,
    public: {
      ...state.public,
      phase: 'awaitingPlay',
    },
    private: privateState,
  };
  if (pending.hook === 'onGameStart') {
    return reduceGameStartRuleInput(
      config,
      resumedState,
      pending,
      inputValue,
      runtime,
    );
  }
  if (!pending.play || !pending.strength) {
    return reject(state, action.player, 'NO_PENDING_CHOICE');
  }
  const playedBy =
    pending.playedBy ?? state.public.field.current?.by ?? action.player;
  if (pending.continuation) {
    const currentConfig: GameConfig = {
      ...config,
      ruleChain: config.ruleChain.filter(
        ({ ruleId }) => ruleId === pending.ruleId,
      ),
    };
    const currentEffects = executeEffectHook(
      currentConfig,
      resumedState,
      runtime,
      'afterPlay',
      pending.play,
      pending.strength,
      {
        previewChoice: true,
        input: {
          ruleId: pending.ruleId,
          value: inputValue,
        },
      },
    );
    const remainingConfig: GameConfig = {
      ...config,
      ruleChain: config.ruleChain.filter(({ ruleId }) =>
        pending.continuation?.remainingRuleIds.includes(ruleId),
      ),
    };
    const continuedRuntime: RuleRuntime = {
      ...runtime,
      setMemory: currentEffects.setMemory,
    };
    const nextSameRuleChoice = pending.continuation.remainingChoices?.[0];
    const clearRequested =
      pending.continuation.clearRequested || currentEffects.clearRequested;
    const dynamicRequest = currentEffects.choiceRequests?.[0];
    if (dynamicRequest) {
      return {
        state: {
          ...currentEffects.state,
          public: { ...currentEffects.state.public, phase: 'awaitingChoice' },
          private: {
            ...currentEffects.state.private,
            pendingChoice: {
              ...dynamicRequest,
              play: pending.play,
              strength: pending.strength,
              playedBy,
              continuation: {
                remainingChoices: [
                  ...(currentEffects.choiceRequests ?? []).slice(1),
                  ...(pending.continuation.remainingChoices ?? []),
                ],
                remainingRuleIds: pending.continuation.remainingRuleIds,
                clearRequested,
              },
            },
          },
        },
        events: [],
        rejections: [],
        setMemory: currentEffects.setMemory,
      };
    }
    if (nextSameRuleChoice) {
      const withEvents = appendEvents(
        currentEffects.state,
        currentEffects.events,
      );
      return {
        state: {
          ...withEvents,
          public: {
            ...withEvents.public,
            phase: 'awaitingChoice',
          },
          private: {
            ...withEvents.private,
            pendingChoice: {
              ...nextSameRuleChoice,
              play: pending.play,
              strength: pending.strength,
              playedBy,
              continuation: {
                ...(pending.continuation.remainingChoices
                  ? {
                      remainingChoices:
                        pending.continuation.remainingChoices.slice(1),
                    }
                  : {}),
                remainingRuleIds: pending.continuation.remainingRuleIds,
                clearRequested,
              },
            },
          },
        },
        events: currentEffects.events,
        rejections: [],
        setMemory: currentEffects.setMemory,
      };
    }
    const preview = executeEffectHook(
      remainingConfig,
      currentEffects.state,
      continuedRuntime,
      'afterPlay',
      pending.play,
      pending.strength,
      { previewChoice: true },
    );
    const nextRequest = preview.choiceRequests?.[0];
    if (nextRequest) {
      const withEvents = appendEvents(
        currentEffects.state,
        currentEffects.events,
      );
      return {
        state: {
          ...withEvents,
          public: {
            ...withEvents.public,
            phase: 'awaitingChoice',
          },
          private: {
            ...withEvents.private,
            pendingChoice: {
              ...nextRequest,
              play: pending.play,
              strength: pending.strength,
              playedBy,
              continuation: {
                remainingChoices: (preview.choiceRequests ?? []).filter(
                  (candidate, index) =>
                    index > 0 && candidate.ruleId === nextRequest.ruleId,
                ),
                remainingRuleIds: pending.continuation.remainingRuleIds.filter(
                  (ruleId) => ruleId !== nextRequest.ruleId,
                ),
                clearRequested,
              },
            },
          },
        },
        events: currentEffects.events,
        rejections: [],
        setMemory: currentEffects.setMemory,
      };
    }
    const remainingEffects = executeEffectHook(
      remainingConfig,
      currentEffects.state,
      continuedRuntime,
      'afterPlay',
      pending.play,
      pending.strength,
    );
    return completeAfterPlay(
      config,
      remainingEffects.state,
      playedBy,
      [...currentEffects.events, ...remainingEffects.events],
      {
        ...remainingEffects,
        clearRequested: clearRequested || remainingEffects.clearRequested,
      },
      runtime,
    );
  }
  const effects = executeEffectHook(
    config,
    resumedState,
    runtime,
    'afterPlay',
    pending.play,
    pending.strength,
    {
      previewChoice: true,
      input: {
        ruleId: pending.ruleId,
        value: inputValue,
      },
    },
  );
  const dynamicRequest = effects.choiceRequests?.[0];
  if (dynamicRequest) {
    return {
      state: {
        ...effects.state,
        public: { ...effects.state.public, phase: 'awaitingChoice' },
        private: {
          ...effects.state.private,
          pendingChoice: {
            ...dynamicRequest,
            play: pending.play,
            strength: pending.strength,
            playedBy,
            continuation: {
              remainingChoices: (effects.choiceRequests ?? []).slice(1),
              remainingRuleIds: [],
              clearRequested: false,
            },
          },
        },
      },
      events: [],
      rejections: [],
      setMemory: effects.setMemory,
    };
  }
  return completeAfterPlay(
    config,
    effects.state,
    playedBy,
    effects.events,
    effects,
    runtime,
  );
}

function simultaneousRequestForAction(
  pending: NonNullable<GameState['private']['pendingChoice']>,
  action: Extract<GameAction, { type: 'ruleInput' }>,
): PendingChoiceRequest | undefined {
  const submitted = pending.submittedChoices ?? [];
  return pending.simultaneousChoices?.find(
    (request) =>
      request.player === action.player &&
      request.choiceId === action.choiceId &&
      !submitted.some(
        (response) =>
          response.player === request.player &&
          response.choiceId === request.choiceId,
      ),
  );
}

function submittedChoice(
  request: PendingChoiceRequest,
  action: Extract<GameAction, { type: 'ruleInput' }>,
): SubmittedRuleChoice | null {
  const kind = request.kind ?? 'cards';
  if (
    kind === 'cards' &&
    'cardIds' in action &&
    action.cardIds !== undefined &&
    action.cardIds.length === request.count &&
    new Set(action.cardIds).size === action.cardIds.length &&
    action.cardIds.every((cardId) =>
      (request.optionCardIds ?? []).includes(cardId),
    )
  ) {
    return {
      player: action.player,
      choiceId: action.choiceId,
      cardIds: [...action.cardIds],
    };
  }
  if (
    kind === 'player' &&
    'playerId' in action &&
    action.playerId !== undefined &&
    (request.optionPlayerIds ?? []).includes(action.playerId)
  ) {
    return {
      player: action.player,
      choiceId: action.choiceId,
      playerId: action.playerId,
    };
  }
  return null;
}

function reduceSimultaneousRuleInput(
  config: GameConfig,
  state: GameState,
  action: Extract<GameAction, { type: 'ruleInput' }>,
  runtime: RuleRuntime,
): GameTransition {
  const pending = state.private.pendingChoice!;
  const request = simultaneousRequestForAction(pending, action);
  if (!request) {
    return reject(state, action.player, 'NO_PENDING_CHOICE');
  }
  const response = submittedChoice(request, action);
  if (!response) {
    return reject(state, action.player, 'INVALID_RULE_CHOICE');
  }
  const submittedChoices = [...(pending.submittedChoices ?? []), response];
  const requests = pending.simultaneousChoices ?? [];
  if (submittedChoices.length < requests.length) {
    return {
      state: {
        ...state,
        private: {
          ...state.private,
          pendingChoice: { ...pending, submittedChoices },
        },
      },
      events: [],
      rejections: [],
      setMemory: runtime.setMemory,
    };
  }

  const serialPending = { ...pending };
  delete serialPending.simultaneousChoices;
  delete serialPending.submittedChoices;
  let currentState: GameState = {
    ...state,
    private: {
      ...state.private,
      pendingChoice: serialPending,
    },
  };
  let currentRuntime = runtime;
  const events: EngineEvent[] = [];
  for (const expected of requests) {
    const selected = submittedChoices.find(
      (candidate) =>
        candidate.player === expected.player &&
        candidate.choiceId === expected.choiceId,
    );
    const activePending = currentState.private.pendingChoice;
    if (
      !selected ||
      !activePending ||
      activePending.player !== expected.player ||
      activePending.choiceId !== expected.choiceId
    ) {
      return reject(state, action.player, 'INVALID_RULE_CHOICE');
    }
    const transition = reduceSingleRuleInput(
      config,
      currentState,
      'cardIds' in selected
        ? { type: 'ruleInput', ...selected }
        : { type: 'ruleInput', ...selected },
      currentRuntime,
    );
    if (transition.rejections.length > 0) {
      return reject(state, action.player, 'INVALID_RULE_CHOICE');
    }
    currentState = transition.state;
    currentRuntime = {
      ...currentRuntime,
      setMemory: transition.setMemory ?? currentRuntime.setMemory,
    };
    events.push(...transition.events);
  }
  return {
    state: currentState,
    events,
    rejections: [],
    setMemory: currentRuntime.setMemory,
  };
}

function reduceRuleInput(
  config: GameConfig,
  state: GameState,
  action: Extract<GameAction, { type: 'ruleInput' }>,
  runtime: RuleRuntime,
): GameTransition {
  return state.private.pendingChoice?.simultaneousChoices
    ? reduceSimultaneousRuleInput(config, state, action, runtime)
    : reduceSingleRuleInput(config, state, action, runtime);
}

function reduceMiniGameCommand(
  state: GameState,
  action: Extract<GameAction, { type: 'miniGameCommand' }>,
): GameTransition {
  const pending = state.private.pendingChoice;
  if (
    state.public.phase !== 'awaitingChoice' ||
    pending?.kind !== 'miniGame' ||
    !pending.miniGameState ||
    pending.miniGameState.id !== action.miniGameId ||
    !pending.participants?.includes(action.player)
  ) {
    return reject(state, action.player, 'NO_PENDING_CHOICE');
  }
  const miniGameState =
    pending.miniGameState.kind === 'bomb_throw_15'
      ? applyBombThrowCommand(pending.miniGameState, {
          playerId: action.player,
          ...(action.direction === undefined
            ? {}
            : { direction: action.direction }),
          ...(action.throwBomb === undefined
            ? {}
            : { throwBomb: action.throwBomb }),
        })
      : action.round !== undefined && action.option !== undefined
        ? canAnswerBinaryQuiz(pending.miniGameState, {
            playerId: action.player,
            round: action.round,
            option: action.option,
          })
          ? answerBinaryQuiz(pending.miniGameState, {
              playerId: action.player,
              round: action.round,
              option: action.option,
            })
          : null
        : null;
  if (!miniGameState) {
    return reject(state, action.player, 'INVALID_RULE_CHOICE');
  }
  return {
    state: {
      ...state,
      private: {
        ...state.private,
        pendingChoice: { ...pending, miniGameState },
      },
    },
    events: [],
    rejections: [],
  };
}

function reduceMiniGameQuestion(
  state: GameState,
  action: Extract<GameAction, { type: 'miniGameQuestion' }>,
): GameTransition {
  const pending = state.private.pendingChoice;
  if (
    state.public.phase !== 'awaitingChoice' ||
    pending?.kind !== 'miniGame' ||
    pending.miniGameState?.kind !== 'binary_quiz_race' ||
    pending.miniGameState.id !== action.miniGameId
  ) {
    return reject(state, action.player, 'NO_PENDING_CHOICE');
  }
  const miniGameState = setBinaryQuizQuestion(pending.miniGameState, {
    round: action.round,
    question: action.question,
  });
  if (miniGameState === pending.miniGameState) {
    return reject(state, action.player, 'INVALID_RULE_CHOICE');
  }
  return {
    state: {
      ...state,
      private: {
        ...state.private,
        pendingChoice: { ...pending, miniGameState },
      },
    },
    events: [],
    rejections: [],
  };
}

function reduceMiniGameTick(
  config: GameConfig,
  state: GameState,
  action: Extract<GameAction, { type: 'miniGameTick' }>,
  runtime: RuleRuntime,
): GameTransition {
  const pending = state.private.pendingChoice;
  if (
    state.public.phase !== 'awaitingChoice' ||
    pending?.kind !== 'miniGame' ||
    !pending.miniGameState ||
    pending.miniGameState.id !== action.miniGameId
  ) {
    return reject(state, action.player, 'NO_PENDING_CHOICE');
  }
  const miniGameState =
    pending.miniGameState.kind === 'bomb_throw_15'
      ? advanceBombThrowMiniGame(pending.miniGameState, {
          ...(action.deltaMs === undefined ? {} : { deltaMs: action.deltaMs }),
          automatedPlayerIds: action.automatedPlayerIds ?? [],
        })
      : advanceBinaryQuizRace(pending.miniGameState, {
          ...(action.deltaMs === undefined ? {} : { deltaMs: action.deltaMs }),
          automatedPlayerIds: action.automatedPlayerIds ?? [],
        });
  const nextState: GameState = {
    ...state,
    private: {
      ...state.private,
      pendingChoice: { ...pending, miniGameState },
    },
  };
  if (
    (miniGameState.kind === 'bomb_throw_15' &&
      !bombThrowComplete(miniGameState)) ||
    (miniGameState.kind === 'binary_quiz_race' &&
      !binaryQuizRaceComplete(miniGameState))
  ) {
    return { state: nextState, events: [], rejections: [] };
  }
  const result =
    miniGameState.kind === 'bomb_throw_15'
      ? bombThrowResult(miniGameState)
      : binaryQuizRaceResult(miniGameState);
  return reduceRuleInput(
    config,
    nextState,
    {
      type: 'ruleInput',
      player: pending.player,
      choiceId: pending.choiceId,
      miniGameId: result.miniGameId,
      ...('winnerPlayerId' in result
        ? {
            winnerPlayerId: result.winnerPlayerId,
            scores: result.scores,
          }
        : {
            winnerPlayerIds: result.winnerPlayerIds,
            scores: result.scores,
          }),
    },
    runtime,
  );
}

export function reduceGame(
  config: GameConfig,
  state: GameState,
  action: GameAction,
  runtime: RuleRuntime = noRuleRuntime(),
): GameTransition {
  if (action.type === 'miniGameCommand') {
    return reduceMiniGameCommand(state, action);
  }
  if (action.type === 'miniGameQuestion') {
    return reduceMiniGameQuestion(state, action);
  }
  if (action.type === 'miniGameTick') {
    return reduceMiniGameTick(config, state, action, runtime);
  }
  if (action.type === 'ruleInput') {
    return reduceRuleInput(config, state, action, runtime);
  }
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
