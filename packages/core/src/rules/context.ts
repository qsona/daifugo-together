import type { GameConfig, GameState } from '../game/types.js';
import { nextRandom, randomInt, seedRng } from '../rng/rng.js';
import type { StrengthOrder } from '../play/strength.js';
import type { RuleRuntime } from './chain.js';
import type { RuleContext } from './contract.js';

export function buildRuleContext(
  config: GameConfig,
  state: GameState,
  strength: StrengthOrder,
  runtime: RuleRuntime,
): RuleContext {
  let rng = seedRng(`${config.gameSeed}:rule-context`);

  return {
    contractVersion: 1,
    game: {
      gameIndex: config.gameIndex,
      seats: [...config.seats],
      direction: state.public.direction,
      turn: state.public.turn,
      players: config.seats.map((id) => {
        const player = state.players[id];
        if (!player) {
          throw new Error(`Missing player state: ${id}`);
        }
        return {
          id,
          hand: player.hand,
          status: player.status,
          standing: player.standing ?? null,
        };
      }),
      field: state.public.field,
      discard: state.public.discard,
      history: state.public.history,
      strength,
    },
    setHistory: runtime.setHistory,
    memory: {
      game: {},
      set: runtime.setMemory['__context__'] ?? {},
    },
    rng: {
      next() {
        const result = nextRandom(rng);
        rng = result.state;
        return result.value;
      },
      int(maxExclusive) {
        const result = randomInt(rng, maxExclusive);
        rng = result.state;
        return result.value;
      },
    },
  };
}
