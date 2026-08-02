import { reduceSet, startSetTransition } from '../set/set-reducer.js';
import type { SetAction, SetState, SetTransition } from '../set/types.js';
import type { GameConfig } from '../game/types.js';
import {
  NO_RULE_CHAIN_PORT,
  type RuleChainPort,
  type RuleRuntime,
} from '../rules/chain.js';
import { engineFeaturesOf, type RuleChainEntry } from '../rules/contract.js';
import { createDeck } from '../cards/card.js';
import { enumerateLegalPlays } from '../play/candidates.js';
import type { Play } from '../play/play.js';
import { randomInt, seedRng, type RngState } from '../rng/rng.js';

export interface SimulateOptions {
  games: number;
  seed: string;
  ruleChain: RuleChainEntry[];
  port?: RuleChainPort;
  botPolicy?: 'randomLegal';
  gamesPerSet?: number;
}

export interface SimReport {
  completed: number;
  invariantViolations: {
    game: number;
    invariant: string;
    detail: string;
  }[];
  failsafeActivations: number;
  leadNoLegalMoveActivations: number;
  turnLimitActivations: number;
  avgTurnsPerGame: number;
  ruleFiredCounts: Record<string, number>;
}

export function summarizeFailsafes(
  events: readonly SetTransition['events'][number][],
): {
  total: number;
  leadNoLegalMove: number;
  turnLimit: number;
} {
  const failsafes = events.filter((event) => event.type === 'failsafe');
  return {
    total: failsafes.length,
    leadNoLegalMove: failsafes.filter(
      (event) => event.reason === 'leadNoLegalMove',
    ).length,
    turnLimit: failsafes.filter((event) => event.reason === 'turnLimit').length,
  };
}

function gameConfig(state: SetState): GameConfig {
  const gameIndex =
    state.phase.name === 'setResult'
      ? Math.max(0, state.results.length - 1)
      : state.phase.gameIndex;
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

export interface SimulationDecision {
  setIndex: number;
  state: SetState;
  config: GameConfig;
  runtime: RuleRuntime;
  player: string;
  legalPlays: Play[];
  canPass: boolean;
}

function invariantProblems(state: SetState): string[] {
  const game = state.currentGame;
  if (!game) {
    return [];
  }
  const cards = [
    ...Object.values(game.players).flatMap((player) => player.hand),
    ...(game.public.field.current?.play.cards ?? []),
    ...game.public.discard,
    ...game.private.excluded,
  ];
  const deckSize = createDeck(engineFeaturesOf(state.ruleChain)).length;
  const problems: string[] = [];
  if (
    cards.length !== deckSize ||
    new Set(cards.map((card) => card.id)).size !== deckSize
  ) {
    problems.push('card-conservation');
  }
  const standings = Object.values(game.players).flatMap((player) =>
    player.standing === undefined ? [] : [player.standing],
  );
  if (new Set(standings).size !== standings.length) {
    problems.push('standing-bijection');
  }
  if (
    game.public.phase === 'awaitingPlay' &&
    (!game.public.turn || game.players[game.public.turn]?.status !== 'active')
  ) {
    problems.push('active-turn');
  }
  return problems;
}

function invalidEffectProblems(
  events: readonly SetTransition['events'][number][],
): string[] {
  return events.flatMap((event) => {
    if (
      event.type !== 'effectRejected' ||
      !event.detail ||
      typeof event.detail !== 'object' ||
      Array.isArray(event.detail) ||
      typeof event.detail.reason !== 'string'
    ) {
      return [];
    }
    return [`${event.ruleId}:${event.hook}:${event.detail.reason}`];
  });
}

export function* createSimulationRun(
  options: SimulateOptions,
): Generator<SimulationDecision, SimReport, SetAction> {
  if (!Number.isSafeInteger(options.games) || options.games < 0) {
    throw new Error('games must be a non-negative safe integer');
  }
  const port = options.port ?? NO_RULE_CHAIN_PORT;
  const invariantViolations: SimReport['invariantViolations'] = [];
  const ruleFiredCounts: Record<string, number> = {};
  let completed = 0;
  let completedGames = 0;
  let totalTurns = 0;
  let failsafeActivations = 0;
  let leadNoLegalMoveActivations = 0;
  let turnLimitActivations = 0;

  for (let setIndex = 0; setIndex < options.games; setIndex += 1) {
    const started = startSetTransition(
      {
        setId: `sim-${setIndex}`,
        config: {
          gamesPerSet: options.gamesPerSet ?? 3,
          interimAutoAdvanceMs: 0,
        },
        members: ['p1', 'p2', 'p3', 'p4'].map((id) => ({
          id,
          displayName: id,
          isAI: true,
        })),
        ruleChain: options.ruleChain,
        setSeed: `${options.seed}:${setIndex}`,
      },
      port,
    );
    let state = started.state;
    const initialFailsafes = summarizeFailsafes(started.events);
    failsafeActivations += initialFailsafes.total;
    leadNoLegalMoveActivations += initialFailsafes.leadNoLegalMove;
    turnLimitActivations += initialFailsafes.turnLimit;
    for (const problem of invalidEffectProblems(started.events)) {
      invariantViolations.push({
        game: setIndex,
        invariant: 'invalid-effect',
        detail: `initial:${problem}`,
      });
    }
    for (const result of state.results) {
      completedGames += 1;
      totalTurns += state.currentGame?.public.turnCount ?? 0;
      for (const ruleId of result.firedRuleIds) {
        ruleFiredCounts[ruleId] = (ruleFiredCounts[ruleId] ?? 0) + 1;
      }
    }
    let actions = 0;
    while (state.phase.name !== 'setResult' && actions < 10_000) {
      const beforeResults = state.results.length;
      let action: SetAction;
      if (state.phase.name !== 'gameInProgress' || !state.currentGame) {
        action = { type: 'advance' };
      } else if (state.currentGame.public.phase === 'awaitingChoice') {
        const pending = state.currentGame.private.pendingChoice;
        if (!pending) {
          throw new Error('Simulation choice phase has no pending choice');
        }
        action = {
          type: 'ruleInput',
          player: pending.player,
          choiceId: pending.choiceId,
          ...((pending.kind ?? 'cards') === 'player'
            ? { playerId: [...(pending.optionPlayerIds ?? [])].sort()[0] ?? '' }
            : {
                cardIds: [...(pending.optionCardIds ?? [])]
                  .sort()
                  .slice(0, pending.count ?? 0),
              }),
        };
      } else {
        const player = state.currentGame.public.turn;
        if (!player) {
          throw new Error('Simulation has no active turn');
        }
        const config = gameConfig(state);
        const ruleRuntime = runtime(state, port);
        const legalPlays = enumerateLegalPlays(
          config,
          state.currentGame,
          player,
          ruleRuntime,
        );
        action = yield {
          setIndex,
          state,
          config,
          runtime: ruleRuntime,
          player,
          legalPlays,
          canPass: state.currentGame.public.field.current !== undefined,
        };
      }
      const transition = reduceSet(state, action, port);
      const failsafes = summarizeFailsafes(transition.events);
      failsafeActivations += failsafes.total;
      leadNoLegalMoveActivations += failsafes.leadNoLegalMove;
      turnLimitActivations += failsafes.turnLimit;
      for (const problem of invalidEffectProblems(transition.events)) {
        invariantViolations.push({
          game: setIndex,
          invariant: 'invalid-effect',
          detail: `action=${actions}:${problem}`,
        });
      }
      if (failsafes.turnLimit > 0) {
        invariantViolations.push({
          game: setIndex,
          invariant: 'forced-termination',
          detail: `turnLimit activations=${failsafes.turnLimit}, action=${actions}`,
        });
      }
      if (transition.rejections.length > 0) {
        invariantViolations.push({
          game: setIndex,
          invariant: 'accepted-action',
          detail: JSON.stringify(transition.rejections),
        });
        break;
      }
      state = transition.state;
      for (const problem of invariantProblems(state)) {
        invariantViolations.push({
          game: setIndex,
          invariant: problem,
          detail: `action=${actions}`,
        });
      }
      if (state.results.length > beforeResults) {
        const newResults = state.results.slice(beforeResults);
        completedGames += newResults.length;
        totalTurns += state.currentGame?.public.turnCount ?? 0;
        for (const result of newResults) {
          for (const ruleId of result.firedRuleIds) {
            ruleFiredCounts[ruleId] = (ruleFiredCounts[ruleId] ?? 0) + 1;
          }
        }
      }
      actions += 1;
    }
    if (state.phase.name === 'setResult') {
      const serialized = JSON.stringify(state);
      if (JSON.stringify(JSON.parse(serialized)) !== serialized) {
        invariantViolations.push({
          game: setIndex,
          invariant: 'json-roundtrip',
          detail: 'set result is not JSON round-trip stable',
        });
      }
      completed += 1;
    } else if (actions >= 10_000) {
      invariantViolations.push({
        game: setIndex,
        invariant: 'termination',
        detail: 'set exceeded 10000 actions',
      });
    }
  }
  return {
    completed,
    invariantViolations,
    failsafeActivations,
    leadNoLegalMoveActivations,
    turnLimitActivations,
    avgTurnsPerGame: completedGames === 0 ? 0 : totalTurns / completedGames,
    ruleFiredCounts,
  };
}

export function simulate(options: SimulateOptions): SimReport {
  let rng: RngState = seedRng(`${options.seed}:bot`);
  const run = createSimulationRun(options);
  let step = run.next();
  while (!step.done) {
    const decision = step.value;
    const choices: SetAction[] = decision.legalPlays.map((play) => ({
      type: 'play',
      player: decision.player,
      cards: play.cards.map((card) => card.id),
    }));
    if (decision.canPass) {
      choices.push({ type: 'pass', player: decision.player });
    }
    if (choices.length === 0) {
      throw new Error('Simulation found no legal action');
    }
    const selected = randomInt(rng, choices.length);
    rng = selected.state;
    step = run.next(choices[selected.value]!);
  }
  return step.value;
}
