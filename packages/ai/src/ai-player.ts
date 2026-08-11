import { chooseHeuristicPlayForView } from './heuristic.js';
import {
  DEFAULT_MCTS_CONFIG,
  type AiDecision,
  type AiPlayer,
  type MctsConfig,
  type DecideMoveInput,
} from './types.js';
import { AiWorkerPool } from './worker-pool.js';

export interface CreateAiPlayerOptions {
  pool?: AiWorkerPool;
  search?: Partial<MctsConfig>;
}

function fallbackReason(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  return reason.split('\n', 1)[0]!.slice(0, 240) || 'unknown-worker-error';
}

export function createAiPlayer(options: CreateAiPlayerOptions = {}): AiPlayer {
  const pool = options.pool ?? new AiWorkerPool();
  const ownsPool = options.pool === undefined;
  const config = { ...DEFAULT_MCTS_CONFIG, ...options.search };

  return {
    async decideMove(input: DecideMoveInput): Promise<AiDecision> {
      if (input.legalPlays.length === 0) {
        throw new Error('AI received no legal play');
      }
      if (input.legalPlays.length === 1) {
        return {
          play: input.legalPlays[0]!,
          usedFallback: 'none',
          stats: {
            playouts: 0,
            candidates: [],
            workerThread: false,
          },
        };
      }
      try {
        const result = await pool.run(
          {
            view: input.view,
            legalPlays: input.legalPlays,
            budget: input.budget,
            difficulty: input.difficulty,
            config,
            seed: input.seed,
            ...(input.ruleContext === undefined
              ? {}
              : { ruleContext: input.ruleContext }),
          },
          input.budget.hardMs,
        );
        return {
          play: result.play,
          usedFallback: result.completed ? 'none' : 'partial-search',
          ...(result.completed ? {} : { fallbackReason: 'soft-deadline' }),
          stats: result.stats,
        };
      } catch (error) {
        return {
          play: chooseHeuristicPlayForView(input.legalPlays, input.view),
          usedFallback: 'heuristic',
          fallbackReason: fallbackReason(error),
          stats: {
            playouts: 0,
            candidates: [],
            workerThread: false,
          },
        };
      }
    },

    async close() {
      if (ownsPool) {
        await pool.close();
      }
    },
  };
}
