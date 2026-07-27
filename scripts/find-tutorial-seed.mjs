#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

import {
  buildPlayerSnapshot,
  enumerateLegalPlays,
  NO_RULE_CHAIN_PORT,
  reduceSet,
  startSetTransition,
} from '../packages/core/dist/index.js';

const PLAYER_IDS = [
  'tutorial-human',
  'tutorial-ai-1',
  'tutorial-ai-2',
  'tutorial-ai-3',
];
const HIGH_RANK_SCORE = { K: 1, A: 2, 2: 3 };

function start(seed, gamesPerSet = 3) {
  return startSetTransition({
    setId: `tutorial-candidate:${seed}`,
    config: { gamesPerSet, interimAutoAdvanceMs: 0 },
    members: PLAYER_IDS.map((id, index) => ({
      id,
      displayName: id,
      isAI: index > 0,
    })),
    ruleChain: [],
    setSeed: seed,
  }).state;
}

function strengthScore(hand) {
  return hand.reduce(
    (score, card) => score + (HIGH_RANK_SCORE[card.rank] ?? 0),
    0,
  );
}

export function assessTutorialSeed(seed) {
  const game = start(seed).currentGame;
  if (!game) throw new Error(`Seed did not start a game: ${seed}`);
  const hands = PLAYER_IDS.map((id) => game.players[id]?.hand ?? []);
  const hand = hands[0];
  const rankCounts = new Map();
  for (const card of hand) {
    rankCounts.set(card.rank, (rankCounts.get(card.rank) ?? 0) + 1);
  }
  const scores = hands.map(strengthScore);
  const score = scores[0];
  return {
    seed,
    handIds: hand.map((card) => card.id),
    hasDiamondThree: hand.some((card) => card.id === 'D03'),
    hasPair: [...rankCounts.values()].some((count) => count >= 2),
    strengthScore: score,
    strengthRank: 1 + scores.filter((candidate) => candidate > score).length,
    allStrengthScores: scores,
  };
}

export function isTutorialSeedCandidate(assessment) {
  return (
    assessment.hasDiamondThree &&
    assessment.hasPair &&
    assessment.strengthRank <= 2
  );
}

export function findTutorialSeedCandidates(limit = 10_000) {
  const candidates = [];
  for (let index = 0; index < limit; index += 1) {
    const assessment = assessTutorialSeed(`tutorial-${index}`);
    if (isTutorialSeedCandidate(assessment)) candidates.push(assessment);
  }
  return candidates.sort(
    (left, right) =>
      right.strengthScore - left.strengthScore ||
      left.strengthRank - right.strengthRank ||
      left.seed.localeCompare(right.seed),
  );
}

function gameConfig(state) {
  const gameIndex = state.phase.gameIndex;
  return {
    gameIndex,
    seats: state.members.map((member) => member.id),
    gameSeed: `${state.setSeed}:${gameIndex}`,
    ruleChain: state.ruleChain,
  };
}

async function runAiTrial(seed, ai, trial) {
  let state = start(seed, 1);
  let fieldCleared = false;
  for (
    let action = 0;
    state.phase.name !== 'setResult' && action < 2_000;
    action += 1
  ) {
    if (state.phase.name !== 'gameInProgress' || !state.currentGame) {
      throw new Error(`Unexpected tutorial trial phase: ${state.phase.name}`);
    }
    const player = state.currentGame.public.turn;
    if (!player) throw new Error('Tutorial trial has no active player');
    const config = gameConfig(state);
    const runtime = {
      port: NO_RULE_CHAIN_PORT,
      setHistory: state.results,
      setMemory: state.setMemory,
    };
    const legalPlays = enumerateLegalPlays(
      config,
      state.currentGame,
      player,
      runtime,
    );
    let transition;
    if (legalPlays.length === 0) {
      transition = reduceSet(
        state,
        { type: 'pass', player },
        NO_RULE_CHAIN_PORT,
      );
    } else {
      const view = buildPlayerSnapshot(
        config,
        state.currentGame,
        {
          setId: state.setId,
          setPhase: state.phase,
          members: state.members,
          setResults: state.results,
        },
        player,
        runtime,
      );
      const decision = await ai.decideMove({
        view,
        legalPlays,
        budget: {
          softMs: 50,
          hardMs: 200,
          maxPlayouts: 16,
          sliceMs: 10,
        },
        seed: `${seed}:trial:${trial}:turn:${action}:${player}`,
        difficulty: {
          name: 'normal',
          budgetScale: 1,
          temperature: 0.3,
          rolloutEpsilon: 0.2,
        },
      });
      transition = reduceSet(
        state,
        {
          type: 'play',
          player,
          cards: decision.play.cards.map((card) => card.id),
        },
        NO_RULE_CHAIN_PORT,
      );
    }
    if (transition.rejections.length > 0) {
      throw new Error(JSON.stringify(transition.rejections));
    }
    fieldCleared ||= transition.events.some(
      (event) => event.type === 'fieldCleared',
    );
    state = transition.state;
  }
  if (state.phase.name !== 'setResult') {
    throw new Error('Tutorial trial exceeded 2000 actions');
  }
  const standing = state.outcome?.standings.find(
    (entry) => entry.player === PLAYER_IDS[0],
  )?.totalStanding;
  if (!standing) throw new Error('Tutorial trial has no human standing');
  return { standing, fieldCleared };
}

export async function evaluateTutorialSeedWithAi(seed, trials) {
  if (!Number.isSafeInteger(trials) || trials < 1) {
    throw new Error('trials must be a positive safe integer');
  }
  const { createAiPlayer } = await import('../packages/ai/dist/index.js');
  const ai = createAiPlayer();
  try {
    const results = [];
    for (let trial = 0; trial < trials; trial += 1) {
      results.push(await runAiTrial(seed, ai, trial));
    }
    return {
      seed,
      trials,
      results,
      winRate:
        results.filter((result) => result.standing === 1).length / trials,
      topTwoRate:
        results.filter((result) => result.standing <= 2).length / trials,
      fieldClearedRate:
        results.filter((result) => result.fieldCleared).length / trials,
    };
  } finally {
    await ai.close();
  }
}

function numberArgument(name, fallback) {
  const raw = process.argv.find((argument) => argument.startsWith(`${name}=`));
  if (!raw) return fallback;
  const value = Number(raw.slice(name.length + 1));
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid ${name}: ${raw}`);
  }
  return value;
}

async function main() {
  const explicitSeed = process.argv
    .find((argument) => argument.startsWith('--seed='))
    ?.slice('--seed='.length);
  const trials = numberArgument('--trials', 0);
  if (explicitSeed) {
    const assessment = assessTutorialSeed(explicitSeed);
    const ai =
      trials > 0
        ? await evaluateTutorialSeedWithAi(explicitSeed, trials)
        : undefined;
    console.log(JSON.stringify({ assessment, ai }, null, 2));
    return;
  }
  const search = numberArgument('--search', 10_000);
  const count = numberArgument('--candidates', 10);
  const candidates = findTutorialSeedCandidates(search).slice(0, count);
  console.log(JSON.stringify({ search, candidates }, null, 2));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
