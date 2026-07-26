import { reduceGame } from '../engine/reducer.js';
import { startGame } from '../game/start-game.js';
import {
  TITLE_BY_STANDING,
  type GameConfig,
  type GameResult,
} from '../game/types.js';
import {
  NO_RULE_CHAIN_PORT,
  type RuleChainPort,
  type RuleRuntime,
} from '../rules/chain.js';
import type { RuleChainEntry } from '../rules/contract.js';
import { scoreSet } from './scoring.js';
import type {
  SetAction,
  SetConfig,
  SetEndedEvent,
  SetMember,
  SetState,
  SetTransition,
} from './types.js';

export interface StartSetInput {
  setId: string;
  config: SetConfig;
  members: SetMember[];
  ruleChain: RuleChainEntry[];
  setSeed: string;
}

function gameConfig(state: SetState, gameIndex: number): GameConfig {
  return {
    gameIndex,
    seats: state.members.map((member) => member.id),
    gameSeed: `${state.setSeed}:${gameIndex}`,
    ruleChain: state.ruleChain,
  };
}

function runtime(state: SetState, port: RuleChainPort): RuleRuntime {
  return {
    port,
    setHistory: state.results,
    setMemory: state.setMemory,
  };
}

function gameResult(state: SetState, gameIndex: number): GameResult {
  const game = state.currentGame;
  if (!game || game.public.phase !== 'finished') {
    throw new Error('Current game has not finished');
  }
  return {
    gameIndex,
    standings: state.members
      .map((member) => {
        const standing = game.players[member.id]?.standing;
        if (!standing) {
          throw new Error(`Missing standing: ${member.id}`);
        }
        return {
          player: member.id,
          standing,
          title: TITLE_BY_STANDING[standing],
        };
      })
      .sort((left, right) => left.standing - right.standing),
    firedRuleIds: game.public.firedRules,
  };
}

export function startSet(
  input: StartSetInput,
  port: RuleChainPort = NO_RULE_CHAIN_PORT,
): SetState {
  if (input.members.length !== 4) {
    throw new Error('A set requires exactly four members');
  }
  if (
    !Number.isInteger(input.config.gamesPerSet) ||
    input.config.gamesPerSet < 1
  ) {
    throw new Error('gamesPerSet must be a positive integer');
  }
  const state: SetState = {
    setId: input.setId,
    config: input.config,
    phase: { name: 'gameInProgress', gameIndex: 0 },
    members: input.members,
    ruleChain: input.ruleChain,
    setSeed: input.setSeed,
    results: [],
    setMemory: {},
    currentGame: null,
    outcome: null,
    draining: false,
  };
  const game = startGame(gameConfig(state, 0), runtime(state, port));
  return {
    ...state,
    currentGame: game.state,
    setMemory: game.setMemory ?? state.setMemory,
  };
}

function finishDrainedSet(state: SetState): SetTransition {
  if (state.results.length === 0) {
    return {
      state: { ...state, draining: true },
      events: [],
      rejections: [],
      acceptedAction: { type: 'requestDrain' },
    };
  }
  const outcome = scoreSet(state.setId, state, 'drained');
  const event: SetEndedEvent = {
    type: 'setEnded',
    totals: outcome.standings,
    completion: outcome.completion,
    gamesPlayed: outcome.gamesPlayed,
  };
  return {
    state: {
      ...state,
      draining: true,
      phase: { name: 'setResult' },
      outcome,
    },
    events: [event],
    rejections: [],
    acceptedAction: { type: 'requestDrain' },
  };
}

function advance(state: SetState, port: RuleChainPort): SetTransition {
  if (state.phase.name !== 'interimResult') {
    return {
      state,
      events: [],
      rejections: [
        {
          code: 'INVALID_SET_PHASE',
          detail: 'advance is only valid during interimResult',
        },
      ],
    };
  }
  const nextIndex = state.phase.gameIndex + 1;
  const nextGame = startGame(
    gameConfig(state, nextIndex),
    runtime(state, port),
  );
  return {
    state: {
      ...state,
      phase: { name: 'gameInProgress', gameIndex: nextIndex },
      currentGame: nextGame.state,
      setMemory: nextGame.setMemory ?? state.setMemory,
    },
    events: nextGame.events,
    rejections: [],
    acceptedAction: { type: 'advance' },
  };
}

export function reduceSet(
  state: SetState,
  action: SetAction,
  port: RuleChainPort = NO_RULE_CHAIN_PORT,
): SetTransition {
  if (action.type === 'requestDrain') {
    if (state.phase.name === 'setResult') {
      return {
        state,
        events: [],
        rejections: [
          {
            code: 'INVALID_SET_PHASE',
            detail: 'requestDrain is not valid after setResult',
          },
        ],
      };
    }
    if (state.phase.name === 'interimResult') {
      return finishDrainedSet(state);
    }
    return {
      state: { ...state, draining: true },
      events: [],
      rejections: [],
      acceptedAction: action,
    };
  }
  if (action.type === 'advance') {
    return advance(state, port);
  }
  if (state.phase.name !== 'gameInProgress' || !state.currentGame) {
    return {
      state,
      events: [],
      rejections: [
        {
          player: action.player,
          code: 'NOT_YOUR_TURN',
        },
      ],
    };
  }
  const transition = reduceGame(
    gameConfig(state, state.phase.gameIndex),
    state.currentGame,
    action,
    runtime(state, port),
  );
  if (transition.rejections.length > 0) {
    return {
      state,
      events: transition.events,
      rejections: transition.rejections,
    };
  }
  let nextState: SetState = {
    ...state,
    currentGame: transition.state,
    setMemory: transition.setMemory ?? state.setMemory,
  };
  if (transition.state.public.phase !== 'finished') {
    return {
      state: nextState,
      events: transition.events,
      rejections: [],
      acceptedAction: action,
    };
  }

  const result = gameResult(nextState, state.phase.gameIndex);
  const results = [...state.results, result];
  if (results.length < state.config.gamesPerSet && !state.draining) {
    nextState = {
      ...nextState,
      results,
      phase: {
        name: 'interimResult',
        gameIndex: state.phase.gameIndex,
      },
    };
  } else {
    const scoreInput = { ...nextState, results };
    nextState = {
      ...scoreInput,
      phase: { name: 'setResult' },
      outcome: scoreSet(
        state.setId,
        scoreInput,
        state.draining ? 'drained' : 'completed',
      ),
    };
  }
  return {
    state: nextState,
    events:
      nextState.phase.name === 'setResult' && nextState.outcome
        ? [
            ...transition.events,
            {
              type: 'setEnded',
              totals: nextState.outcome.standings,
              completion: nextState.outcome.completion,
              gamesPlayed: nextState.outcome.gamesPlayed,
            },
          ]
        : transition.events,
    rejections: [],
    acceptedAction: action,
  };
}
