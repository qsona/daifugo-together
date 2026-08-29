import type {
  GameAction,
  GameConfig,
  GameState,
  PlayerId,
  PlayerSnapshot,
  PublicGameEvent,
  RuleMemory,
  SnapshotContext,
} from '../game/types.js';
import { TITLE_BY_STANDING } from '../game/types.js';
import { reduceGame } from '../engine/reducer.js';
import {
  enumerateLegalPlays,
  evaluateCandidates,
  generateCandidates,
} from '../play/candidates.js';
import {
  BINARY_QUIZ_RESULT_MS,
  BINARY_QUIZ_REVEAL_MS,
} from '../minigame/binary-quiz-race.js';
import type { Play } from '../play/play.js';
import { BASE_STRENGTH_ORDER, type StrengthOrder } from '../play/strength.js';
import { noRuleRuntime, type RuleRuntime } from '../rules/chain.js';
import { buildRuleContext, prepareRuleInvocation } from '../rules/context.js';
import { safeModifyStrength } from '../rules/safe-port.js';
import { engineFeaturesOf, type Standings } from '../rules/contract.js';
import { buildPlayerSnapshot } from '../snapshot/snapshot.js';
import { outstandingChoiceRequests } from '../game/pending-choice.js';

const MAX_BINARY_QUIZ_SIMULATION_STEPS = 48;

export interface CreateSimulationApiInput {
  config: GameConfig;
  snapshotContext: SnapshotContext;
  runtime?: RuleRuntime;
}

export interface SimulationPosition {
  state: GameState;
  setMemory: RuleMemory;
}

export interface SimulationApi {
  createPosition(state: GameState, setMemory?: RuleMemory): SimulationPosition;
  enumerateLegalPlays(position: SimulationPosition, player: PlayerId): Play[];
  enumerateLegalPlaysWithStrength(
    position: SimulationPosition,
    player: PlayerId,
  ): { plays: Play[]; strength: StrengthOrder };
  applyPlay(
    position: SimulationPosition,
    action: GameAction,
  ): { position: SimulationPosition; events: PublicGameEvent[] };
  isTerminal(position: SimulationPosition): Standings | null;
  getEffectiveStrengthOrder(position: SimulationPosition): StrengthOrder;
  getPlayerView(position: SimulationPosition, player: PlayerId): PlayerSnapshot;
  fallbackPlay(position: SimulationPosition, player: PlayerId): GameAction;
  serialize(position: SimulationPosition): string;
}

function publicEvents(
  events: ReturnType<typeof reduceGame>['events'],
): PublicGameEvent[] {
  return events.filter(
    (event): event is PublicGameEvent =>
      event.type !== 'effectApplied' && event.type !== 'effectRejected',
  );
}

function terminalStandings(
  config: GameConfig,
  state: GameState,
): Standings | null {
  if (state.public.phase !== 'finished') {
    return null;
  }
  return {
    standings: config.seats
      .map((player) => {
        const standing = state.players[player]?.standing;
        if (!standing) {
          throw new Error(`Finished player has no standing: ${player}`);
        }
        return {
          player,
          standing,
          title: TITLE_BY_STANDING[standing],
        };
      })
      .sort((left, right) => left.standing - right.standing),
  };
}

export function createSimulationApi(
  input: CreateSimulationApiInput,
): SimulationApi {
  const runtime = input.runtime ?? noRuleRuntime();
  const trustedSimulation = runtime.port.trustedSimulation === true;
  const config = trustedSimulation
    ? input.config
    : structuredClone(input.config);
  const snapshotContext = trustedSimulation
    ? input.snapshotContext
    : structuredClone(input.snapshotContext);
  const initialSetMemory = trustedSimulation
    ? runtime.setMemory
    : structuredClone(runtime.setMemory);
  const engineFeatures = engineFeaturesOf(config.ruleChain);

  const runtimeFor = (position: SimulationPosition): RuleRuntime => ({
    ...runtime,
    setMemory: position.setMemory,
  });

  const effectiveStrength = (position: SimulationPosition): StrengthOrder => {
    const { state } = position;
    const invocation = prepareRuleInvocation(
      state,
      config.ruleChain,
      'modifyStrength',
      false,
    );
    const context = buildRuleContext(
      config,
      invocation.state,
      BASE_STRENGTH_ORDER,
      runtimeFor(position),
      {
        hook: 'modifyStrength',
        invocationIndices: invocation.invocationIndices,
      },
    );
    return safeModifyStrength(
      runtime.port,
      config.ruleChain,
      context,
      BASE_STRENGTH_ORDER,
    ).result;
  };

  return {
    createPosition(state, setMemory = initialSetMemory) {
      return {
        state: trustedSimulation ? state : structuredClone(state),
        setMemory: trustedSimulation ? setMemory : structuredClone(setMemory),
      };
    },

    enumerateLegalPlays(position, player) {
      return enumerateLegalPlays(
        config,
        position.state,
        player,
        runtimeFor(position),
      );
    },

    enumerateLegalPlaysWithStrength(position, player) {
      const playerState = position.state.players[player];
      if (!playerState || playerState.status !== 'active') {
        return { plays: [], strength: effectiveStrength(position) };
      }
      const evaluated = evaluateCandidates(
        config,
        position.state,
        generateCandidates(playerState.hand, engineFeatures),
        runtimeFor(position),
      );
      return { plays: evaluated.plays, strength: evaluated.strength };
    },

    applyPlay(position, action) {
      let transition = reduceGame(
        config,
        position.state,
        action,
        runtimeFor(position),
      );
      if (transition.rejections.length > 0) {
        throw new Error(
          `Simulation action was rejected: ${JSON.stringify(
            transition.rejections,
          )}`,
        );
      }
      const binaryQuizSteps = new Map<string, number>();
      while (transition.state.public.phase === 'awaitingChoice') {
        const pending = transition.state.private.pendingChoice;
        if (pending === undefined) {
          throw new Error('Simulation choice phase has no pending choice');
        }
        if (
          pending.kind === 'miniGame' &&
          pending.miniGameState?.kind === 'binary_quiz_race'
        ) {
          const miniGameId = pending.miniGameState.id;
          const steps = (binaryQuizSteps.get(miniGameId) ?? 0) + 1;
          if (steps > MAX_BINARY_QUIZ_SIMULATION_STEPS) {
            throw new Error(
              `Simulation binary quiz exceeded ${String(MAX_BINARY_QUIZ_SIMULATION_STEPS)} choice steps`,
            );
          }
          binaryQuizSteps.set(miniGameId, steps);
        }
        const request = outstandingChoiceRequests(pending)[0] ?? pending;
        const resumed = reduceGame(
          config,
          transition.state,
          pending.kind === 'miniGame' &&
            pending.miniGameState?.kind === 'binary_quiz_race' &&
            pending.miniGameState.phase === 'awaitingQuestion'
            ? {
                type: 'miniGameQuestion',
                player: pending.player,
                miniGameId: pending.miniGameState.id,
                round: pending.miniGameState.round,
                question: {
                  id: `simulation_${String(pending.miniGameState.round)}`,
                  prompt: 'Simulation question',
                  options: [
                    { id: 'a', label: 'A' },
                    { id: 'b', label: 'B' },
                  ],
                  correctOption: 'a',
                },
              }
            : pending.kind === 'miniGame' && pending.miniGameState
              ? {
                  type: 'miniGameTick',
                  player: pending.player,
                  miniGameId: pending.miniGameState.id,
                  automatedPlayerIds:
                    pending.miniGameState.kind === 'binary_quiz_race'
                      ? []
                      : (pending.participants ?? []),
                  ...(pending.miniGameState.kind === 'binary_quiz_race'
                    ? {
                        deltaMs:
                          pending.miniGameState.phase === 'answering'
                            ? pending.miniGameState.roundDurationMs
                            : pending.miniGameState.phase === 'reveal'
                              ? BINARY_QUIZ_REVEAL_MS
                              : BINARY_QUIZ_RESULT_MS,
                      }
                    : {}),
                }
              : {
                  type: 'ruleInput',
                  player: request.player,
                  choiceId: request.choiceId,
                  ...((request.kind ?? 'cards') === 'player'
                    ? {
                        playerId:
                          [...(request.optionPlayerIds ?? [])].sort()[0] ?? '',
                      }
                    : {
                        cardIds: [...(request.optionCardIds ?? [])]
                          .sort()
                          .slice(0, request.count ?? 0),
                      }),
                },
          {
            ...runtimeFor(position),
            setMemory: transition.setMemory ?? position.setMemory,
          },
        );
        if (resumed.rejections.length > 0) {
          throw new Error(
            `Simulation rule input was rejected: ${JSON.stringify(
              resumed.rejections,
            )}`,
          );
        }
        transition = {
          ...resumed,
          events: [...transition.events, ...resumed.events],
        };
      }
      return {
        position: {
          state: transition.state,
          setMemory: transition.setMemory ?? position.setMemory,
        },
        events: publicEvents(transition.events),
      };
    },

    isTerminal(position) {
      return terminalStandings(config, position.state);
    },

    getEffectiveStrengthOrder(position) {
      return effectiveStrength(position);
    },

    getPlayerView(position, player) {
      return buildPlayerSnapshot(
        config,
        position.state,
        snapshotContext,
        player,
        runtimeFor(position),
      );
    },

    fallbackPlay(position, player) {
      const { state } = position;
      if (
        state.public.phase !== 'awaitingPlay' ||
        state.public.turn !== player
      ) {
        throw new Error(`Fallback requested outside ${player}'s turn`);
      }
      if (state.public.field.current) {
        return { type: 'pass', player };
      }
      const ranking = effectiveStrength(position).ranking;
      const rankIndex = new Map<string, number>(
        ranking.map((rank, index) => [rank, index]),
      );
      const fallback = enumerateLegalPlays(
        config,
        state,
        player,
        runtimeFor(position),
      ).sort(
        (left, right) =>
          (rankIndex.get(left.repRank) ?? Number.MAX_SAFE_INTEGER) -
            (rankIndex.get(right.repRank) ?? Number.MAX_SAFE_INTEGER) ||
          right.count - left.count ||
          left.cards[0]!.id.localeCompare(right.cards[0]!.id),
      )[0];
      if (!fallback) {
        throw new Error('No fallback play is available on lead');
      }
      return {
        type: 'play',
        player,
        cards: fallback.cards.map((card) => card.id),
      };
    },

    serialize(position) {
      return JSON.stringify(position);
    },
  };
}
