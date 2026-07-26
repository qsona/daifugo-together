import {
  buildPlayerSnapshot,
  enumerateLegalPlays,
  randomInt,
  reduceSet,
  samePlay,
  seedRng,
  startSet,
} from '../packages/core/dist/index.js';
import {
  createAiPlayer,
  DEFAULT_THINK_BUDGET,
  NORMAL_DIFFICULTY,
} from '../packages/ai/dist/index.js';

const SEATS = ['p1', 'p2', 'p3', 'p4'];
const REWARD = new Map([
  [1, 1],
  [2, 2 / 3],
  [3, 1 / 3],
  [4, 0],
]);

function positiveInteger(name, fallback) {
  const raw = process.env[name];
  const parsed = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return parsed;
}

const setCount = positiveInteger('AI_STRENGTH_SETS', 500);
const requiredGames = positiveInteger('AI_VALIDATION_GAMES', 1_000);
if (setCount * 3 < requiredGames) {
  throw new Error('AI_STRENGTH_SETS must cover AI_VALIDATION_GAMES');
}

function gameConfig(state) {
  if (state.phase.name === 'setResult') {
    throw new Error('Set has no active game');
  }
  return {
    gameIndex: state.phase.gameIndex,
    seats: SEATS,
    gameSeed: `${state.setSeed}:${state.phase.gameIndex}`,
    ruleChain: [],
  };
}

function snapshotContext(state) {
  return {
    setId: state.setId,
    setPhase: state.phase,
    members: state.members,
    setResults: state.results,
  };
}

function randomAction(state, legal, player, initialRng) {
  const choices = legal.map((play) => ({
    type: 'play',
    player,
    cards: play.cards.map((card) => card.id),
  }));
  if (state.currentGame?.public.field.current) {
    choices.push({ type: 'pass', player });
  }
  if (choices.length === 0) {
    throw new Error('Random baseline has no legal action');
  }
  const selected = randomInt(initialRng, choices.length);
  return { action: choices[selected.value], rng: selected.state };
}

function percentile(sorted, ratio) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

const ai = createAiPlayer();
let rng = seedRng('ai-process2-validation:random');
let completedGames = 0;
let rejectedActions = 0;
let illegalDecisions = 0;
let fallbacks = 0;
let totalReward = 0;
let rewardSamples = 0;
const moveTimes = [];
const startedAt = performance.now();

try {
  for (let setIndex = 0; setIndex < setCount; setIndex += 1) {
    const aiSeat = SEATS[setIndex % SEATS.length];
    let state = startSet({
      setId: `ai-validation-${setIndex}`,
      config: { gamesPerSet: 3, interimAutoAdvanceMs: 0 },
      members: SEATS.map((id) => ({
        id,
        displayName: id,
        isAI: id === aiSeat,
      })),
      ruleChain: [],
      setSeed: `ai-validation:${setIndex}`,
    });
    let actions = 0;
    while (state.phase.name !== 'setResult' && actions < 2_000) {
      if (state.phase.name === 'interimResult') {
        const transition = reduceSet(state, { type: 'advance' });
        rejectedActions += transition.rejections.length;
        state = transition.state;
        actions += 1;
        continue;
      }
      const game = state.currentGame;
      const player = game?.public.turn;
      if (!game || !player) {
        throw new Error(`Set ${setIndex} has no active turn`);
      }
      const config = gameConfig(state);
      const legal = enumerateLegalPlays(config, game, player);
      let action;
      if (legal.length === 0) {
        action = { type: 'pass', player };
      } else if (player === aiSeat) {
        const moveStartedAt = performance.now();
        const decision = await ai.decideMove({
          view: buildPlayerSnapshot(
            config,
            game,
            snapshotContext(state),
            player,
          ),
          legalPlays: legal,
          budget: DEFAULT_THINK_BUDGET,
          seed: `${state.setSeed}:${state.phase.gameIndex}:${game.public.turnCount}:${player}`,
          difficulty: NORMAL_DIFFICULTY,
        });
        moveTimes.push(performance.now() - moveStartedAt);
        if (decision.usedFallback !== 'none') {
          fallbacks += 1;
        }
        if (!legal.some((play) => samePlay(play, decision.play))) {
          illegalDecisions += 1;
        }
        action = {
          type: 'play',
          player,
          cards: decision.play.cards.map((card) => card.id),
        };
      } else {
        const selected = randomAction(state, legal, player, rng);
        rng = selected.rng;
        action = selected.action;
      }
      const transition = reduceSet(state, action);
      rejectedActions += transition.rejections.length;
      state = transition.state;
      actions += 1;
    }
    if (state.phase.name !== 'setResult' || actions >= 2_000) {
      throw new Error(`Set ${setIndex} did not terminate`);
    }
    completedGames += state.results.length;
    for (const result of state.results) {
      const standing = result.standings.find(
        (entry) => entry.player === aiSeat,
      )?.standing;
      totalReward += REWARD.get(standing) ?? 0;
      rewardSamples += 1;
    }
    if ((setIndex + 1) % 25 === 0 || setIndex + 1 === setCount) {
      process.stdout.write(
        `validated ${setIndex + 1}/${setCount} sets, meanReward=${(
          totalReward / rewardSamples
        ).toFixed(4)}\n`,
      );
    }
  }
} finally {
  await ai.close();
}

moveTimes.sort((left, right) => left - right);
const meanReward = totalReward / rewardSamples;
const report = {
  setCount,
  completedGames,
  rejectedActions,
  illegalDecisions,
  fallbacks,
  meanReward,
  moves: moveTimes.length,
  moveMs: {
    mean:
      moveTimes.reduce((sum, duration) => sum + duration, 0) / moveTimes.length,
    p50: percentile(moveTimes, 0.5),
    p95: percentile(moveTimes, 0.95),
    max: moveTimes.at(-1),
  },
  elapsedMs: performance.now() - startedAt,
};
console.log(JSON.stringify(report, null, 2));

if (
  completedGames < requiredGames ||
  rejectedActions !== 0 ||
  illegalDecisions !== 0 ||
  meanReward < 0.6 ||
  (report.moveMs.max ?? Infinity) > DEFAULT_THINK_BUDGET.hardMs + 25
) {
  process.exitCode = 1;
}
