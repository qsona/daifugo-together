import { parentPort } from 'node:worker_threads';

const core = await import(
  new URL('../../core/dist/index.js', import.meta.url).href
);

const REWARD = new Map([
  [1, 1],
  [2, 2 / 3],
  [3, 1 / 3],
  [4, 0],
]);

function nextRandom(rng) {
  return core.nextRandom(rng);
}

function randomIndex(rng, length) {
  const selected = core.randomInt(rng, length);
  return { rng: selected.state, index: selected.value };
}

function shuffle(cards, initialRng) {
  const shuffled = [...cards];
  let rng = initialRng;
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const selected = randomIndex(rng, index + 1);
    rng = selected.rng;
    [shuffled[index], shuffled[selected.index]] = [
      shuffled[selected.index],
      shuffled[index],
    ];
  }
  return { cards: shuffled, rng };
}

function cardIds(play) {
  return play.cards.map((card) => card.id).sort();
}

function sortWeakFirst(plays, strength) {
  const rankIndex = new Map(
    strength.ranking.map((rank, index) => [rank, index]),
  );
  return [...plays].sort(
    (left, right) =>
      (rankIndex.get(left.repRank) ?? Number.MAX_SAFE_INTEGER) -
        (rankIndex.get(right.repRank) ?? Number.MAX_SAFE_INTEGER) ||
      right.count - left.count ||
      cardIds(left).join(',').localeCompare(cardIds(right).join(',')),
  );
}

function observedCards(view) {
  const observed = new Map(view.hand.map((card) => [card.id, card]));
  for (const event of view.history) {
    if (event.type === 'played') {
      for (const card of event.play.cards) {
        observed.set(card.id, card);
      }
    }
  }
  if (view.field) {
    for (const card of view.field.play.cards) {
      observed.set(card.id, card);
    }
  }
  return observed;
}

function determinize(view, seed, iteration) {
  const rng = core.seedRng(`${seed}:world:${iteration}`);
  const observed = observedCards(view);
  const unknown = core.createDeck().filter((card) => !observed.has(card.id));
  const shuffled = shuffle(unknown, rng);
  let offset = 0;
  const players = {};
  for (const player of view.players) {
    let hand;
    if (player.id === view.forPlayer) {
      hand = structuredClone(view.hand);
    } else {
      hand = shuffled.cards.slice(offset, offset + player.handCount);
      offset += player.handCount;
    }
    players[player.id] = {
      id: player.id,
      hand,
      status: player.status,
      ...(player.standing === null ? {} : { standing: player.standing }),
      skipCount: 0,
    };
  }
  const currentIds = new Set(
    view.field?.play.cards.map((card) => card.id) ?? [],
  );
  const publicCards = [...observed.values()].filter(
    (card) =>
      !view.hand.some((own) => own.id === card.id) && !currentIds.has(card.id),
  );
  return {
    public: {
      phase: view.gamePhase,
      direction: view.direction,
      turn: view.turn,
      field: {
        ...(view.field ? { current: structuredClone(view.field) } : {}),
        passedSinceLastPlay: [...view.passedSinceLastPlay],
      },
      discard: publicCards,
      standingsTaken: view.players.flatMap((player) =>
        player.standing === null ? [] : [player.standing],
      ),
      history: structuredClone(view.history),
      firedRules: [],
      turnCount: view.history.filter(
        (event) => event.type === 'played' || event.type === 'passed',
      ).length,
    },
    private: {
      excluded: shuffled.cards.slice(offset),
      memory: {},
      rng: shuffled.rng,
      hookCalls: {},
    },
    players,
  };
}

function gameConfig(view, seed) {
  return {
    gameIndex: view.gameIndex,
    seats: [...view.seats],
    gameSeed: seed,
    ruleChain: [],
  };
}

function snapshotContext(view) {
  return {
    setId: view.setId,
    setPhase: view.setPhase,
    members: view.players.map((player) => ({
      id: player.id,
      displayName: player.displayName,
      isAI: player.isAI,
    })),
    setResults: view.setResults,
  };
}

function actionFor(player, play) {
  return {
    type: 'play',
    player,
    cards: play.cards.map((card) => card.id),
  };
}

function scoreState(api, state, player) {
  const terminal = api.isTerminal(state);
  if (terminal) {
    const standing = terminal.standings.find(
      (entry) => entry.player === player,
    )?.standing;
    return REWARD.get(standing) ?? 0;
  }
  const occupied = new Set(
    Object.values(state.players).flatMap((entry) =>
      entry.standing === undefined ? [] : [entry.standing],
    ),
  );
  const remainingStandings = [1, 2, 3, 4].filter(
    (standing) => !occupied.has(standing),
  );
  const estimated = Object.values(state.players)
    .filter((entry) => entry.standing === undefined)
    .sort(
      (left, right) =>
        left.hand.length - right.hand.length || left.id.localeCompare(right.id),
    );
  const estimate = new Map(
    estimated.map((entry, index) => [entry.id, remainingStandings[index]]),
  );
  const standing = state.players[player]?.standing ?? estimate.get(player) ?? 4;
  return REWARD.get(standing) ?? 0;
}

function rollout(api, initialState, rootPlay, payload, iteration) {
  let state = api.applyPlay(
    initialState,
    actionFor(payload.view.forPlayer, rootPlay),
  ).state;
  let rng = core.seedRng(`${payload.seed}:rollout:${iteration}`);
  for (
    let step = 0;
    step < payload.config.cutoffSteps && !api.isTerminal(state);
    step += 1
  ) {
    const player = state.public.turn;
    if (!player) {
      break;
    }
    const legal = api.enumerateLegalPlays(state, player);
    if (legal.length === 0) {
      if (!state.public.field.current) {
        break;
      }
      state = api.applyPlay(state, { type: 'pass', player }).state;
      continue;
    }
    const strength = api.getEffectiveStrengthOrder(state);
    const random = nextRandom(rng);
    rng = random.state;
    let selected;
    if (random.value < payload.difficulty.rolloutEpsilon) {
      const index = randomIndex(rng, legal.length);
      rng = index.rng;
      selected = legal[index.index];
    } else {
      selected = sortWeakFirst(legal, strength)[0];
    }
    state = api.applyPlay(state, actionFor(player, selected)).state;
  }
  return scoreState(api, state, payload.view.forPlayer);
}

function selectUcb(stats, total, c) {
  const unvisited = stats.findIndex((entry) => entry.visits === 0);
  if (unvisited >= 0) {
    return unvisited;
  }
  let best = 0;
  let bestValue = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < stats.length; index += 1) {
    const entry = stats[index];
    const value =
      entry.reward / entry.visits +
      c * Math.sqrt(Math.log(total) / entry.visits);
    if (value > bestValue) {
      best = index;
      bestValue = value;
    }
  }
  return best;
}

function strongestCandidate(stats) {
  return stats
    .map((entry, index) => ({ ...entry, index }))
    .sort(
      (left, right) =>
        right.visits - left.visits ||
        right.reward / Math.max(1, right.visits) -
          left.reward / Math.max(1, left.visits) ||
        left.index - right.index,
    )[0];
}

function finalCandidate(stats, temperature, seed) {
  if (temperature <= 0.01) {
    return strongestCandidate(stats);
  }
  const weighted = stats.map((entry) =>
    Math.pow(entry.visits, 1 / temperature),
  );
  const total = weighted.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) {
    return strongestCandidate(stats);
  }
  const random = core.nextRandom(core.seedRng(`${seed}:final`)).value * total;
  let cursor = 0;
  for (let index = 0; index < stats.length; index += 1) {
    cursor += weighted[index];
    if (random < cursor) {
      return { ...stats[index], index };
    }
  }
  return strongestCandidate(stats);
}

function response(stats, payload, completed, done) {
  const selected = finalCandidate(
    stats,
    payload.difficulty.temperature,
    payload.seed,
  );
  return {
    play: selected.play,
    completed: done,
    stats: {
      playouts: completed,
      candidates: stats.map((entry) => ({
        cardIds: cardIds(entry.play),
        visits: entry.visits,
        meanReward: entry.reward / Math.max(1, entry.visits),
      })),
      workerThread: true,
    },
  };
}

function search(payload, onProgress) {
  if (payload.config.maxTreeDepth !== 1) {
    throw new Error('AI-01 supports maxTreeDepth=1 only');
  }
  const config = gameConfig(payload.view, payload.seed);
  const api = core.createSimulationApi({
    config,
    snapshotContext: snapshotContext(payload.view),
  });
  const sample = determinize(payload.view, payload.seed, -1);
  const strength = api.getEffectiveStrengthOrder(sample);
  const scaled = Math.floor(
    payload.budget.maxPlayouts * payload.difficulty.budgetScale,
  );
  const softLimit = Math.max(1, Math.floor(payload.budget.softMs / 6));
  const target = Math.max(1, Math.min(scaled, softLimit));
  const revisitCap = Math.max(1, Math.floor(target / 2));
  const candidates = sortWeakFirst(payload.legalPlays, strength).slice(
    0,
    Math.min(payload.config.rootCandidateCap, revisitCap),
  );
  const stats = candidates.map((play) => ({
    play,
    visits: 0,
    reward: 0,
  }));
  const progressBatch = Math.max(
    1,
    Math.min(payload.config.playoutBatchSize, target),
  );
  let completed = 0;
  let lastProgressAt = performance.now();
  for (; completed < target; completed += 1) {
    const candidateIndex = selectUcb(
      stats,
      Math.max(1, completed),
      payload.config.ucbC,
    );
    const world = determinize(payload.view, payload.seed, completed);
    const reward = rollout(
      api,
      world,
      stats[candidateIndex].play,
      payload,
      completed,
    );
    stats[candidateIndex].visits += 1;
    stats[candidateIndex].reward += reward;
    const count = completed + 1;
    const now = performance.now();
    if (
      count === 1 ||
      count % progressBatch === 0 ||
      now - lastProgressAt >= payload.budget.sliceMs
    ) {
      onProgress(response(stats, payload, count, false));
      lastProgressAt = now;
    }
  }
  return response(stats, payload, completed, completed === target);
}

if (!parentPort) {
  throw new Error('AI worker must run inside worker_threads');
}

parentPort.postMessage({ kind: 'ready' });

parentPort.on('message', (message) => {
  try {
    parentPort.postMessage({
      kind: 'result',
      id: message.id,
      value: search(message.payload, (value) => {
        parentPort.postMessage({
          kind: 'progress',
          id: message.id,
          value,
        });
      }),
    });
  } catch (error) {
    parentPort.postMessage({
      kind: 'error',
      id: message.id,
      error:
        error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
  }
});
