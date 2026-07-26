import { weakestPlay } from './heuristic.js';
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
          },
          input.budget.hardMs,
        );
        return {
          play: result.play,
          usedFallback: result.completed ? 'none' : 'partial-search',
          stats: result.stats,
        };
      } catch {
        return {
          play: weakestPlay(input.legalPlays, input.view.strengthNote.inverted),
          usedFallback: 'heuristic',
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
