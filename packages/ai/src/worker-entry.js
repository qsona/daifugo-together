import { parentPort } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';

const core = await import(
  new URL('../../core/dist/index.js', import.meta.url).href
);

const REWARD = new Map([
  [1, 1],
  [2, 2 / 3],
  [3, 1 / 3],
  [4, 0],
]);

// TS-03 (Node 26.5.0): cutoff 24 averaged about 0.9 playout/ms.
// Keep roughly 3x headroom for shared CPU and active rule overhead.
const CALIBRATED_MS_PER_PLAYOUT = 3;

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

function knownCardZones(view, engineFeatures) {
  // ジョーカー等の機能宣言つき部屋ではデッキが 52 枚ではない。ruleChain 由来の
  // 機能集合で同じデッキを再構成しないと、保存則チェックが常に破れて
  // 全手番が heuristic フォールバックに落ちる。
  const deck = new Map(
    core.createDeck(engineFeatures).map((card) => [card.id, card]),
  );
  const zones = new Map();
  const clearKnownField = () => {
    for (const [cardId, zone] of zones) {
      if (zone.kind === 'field') zones.set(cardId, { kind: 'discard' });
    }
  };
  for (const event of view.history) {
    if (event.type === 'played') {
      clearKnownField();
      for (const card of event.play.cards) {
        zones.set(card.id, { kind: 'field' });
      }
    } else if (event.type === 'fieldCleared') {
      clearKnownField();
    } else if (event.type === 'cardsMoved') {
      if (event.cardIds) {
        for (const cardId of event.cardIds) {
          if (!deck.has(cardId)) {
            throw new Error(`AI observed an unknown card: ${cardId}`);
          }
          zones.set(cardId, structuredClone(event.to));
        }
      } else if (event.from.kind === 'hand' && event.to.kind === 'hand') {
        // Hand-to-hand moves intentionally omit identities. A card that was
        // known from an earlier public zone becomes hidden again.
        for (const [cardId, zone] of zones) {
          if (zone.kind === 'hand' && zone.player === event.from.player) {
            zones.delete(cardId);
          }
        }
      }
    }
  }
  const currentIds = new Set(view.field?.play.cards.map((card) => card.id));
  for (const [cardId, zone] of zones) {
    if (zone.kind === 'field' && !currentIds.has(cardId)) {
      zones.set(cardId, { kind: 'discard' });
    }
  }
  if (view.field) {
    for (const card of view.field.play.cards) {
      zones.set(card.id, { kind: 'field' });
    }
  }
  for (const card of view.hand) {
    zones.set(card.id, { kind: 'hand', player: view.forPlayer });
  }
  return { deck, zones };
}

function determinize(view, seed, iteration, engineFeatures) {
  const rng = core.seedRng(`${seed}:world:${iteration}`);
  const { deck, zones } = knownCardZones(view, engineFeatures);
  const unknown = [...deck.values()].filter((card) => !zones.has(card.id));
  const shuffled = shuffle(unknown, rng);
  let offset = 0;
  const players = {};
  for (const player of view.players) {
    let hand;
    if (player.id === view.forPlayer) {
      hand = structuredClone(view.hand);
    } else {
      const known = [...zones]
        .filter(([, zone]) => zone.kind === 'hand' && zone.player === player.id)
        .map(([cardId]) => deck.get(cardId));
      const unknownCount = player.handCount - known.length;
      if (unknownCount < 0) {
        throw new Error(`AI observed too many cards in ${player.id}'s hand`);
      }
      hand = [
        ...known.map((card) => structuredClone(card)),
        ...shuffled.cards.slice(offset, offset + unknownCount),
      ];
      offset += unknownCount;
    }
    players[player.id] = {
      id: player.id,
      hand: core.sortCards(hand),
      status: player.status,
      ...(player.standing === null ? {} : { standing: player.standing }),
      skipCount: 0,
    };
  }
  const publicCards = [...zones]
    .filter(([, zone]) => zone.kind === 'discard')
    .map(([cardId]) => deck.get(cardId));
  if (publicCards.length !== view.discardCount) {
    throw new Error(
      `AI discard observation mismatch: ${publicCards.length}/${view.discardCount}`,
    );
  }
  if (shuffled.cards.length - offset !== view.excludedCount) {
    throw new Error(
      `AI card conservation mismatch: ${String(
        shuffled.cards.length - offset,
      )}/${String(view.excludedCount)}`,
    );
  }
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

function gameConfig(view, gameSeed, ruleChain) {
  return {
    gameIndex: view.gameIndex,
    seats: [...view.seats],
    gameSeed,
    ruleChain,
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

function scoreState(api, position, player) {
  const terminal = api.isTerminal(position);
  if (terminal) {
    const standing = terminal.standings.find(
      (entry) => entry.player === player,
    )?.standing;
    return REWARD.get(standing) ?? 0;
  }
  const { state } = position;
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
  let position = api.applyPlay(
    api.createPosition(initialState),
    actionFor(payload.view.forPlayer, rootPlay),
  ).position;
  let rng = core.seedRng(`${payload.seed}:rollout:${iteration}`);
  for (
    let step = 0;
    step < payload.config.cutoffSteps && !api.isTerminal(position);
    step += 1
  ) {
    const { state } = position;
    const player = state.public.turn;
    if (!player) {
      break;
    }
    const legal = api.enumerateLegalPlays(position, player);
    if (legal.length === 0) {
      if (!state.public.field.current) {
        break;
      }
      position = api.applyPlay(position, { type: 'pass', player }).position;
      continue;
    }
    const strength = api.getEffectiveStrengthOrder(position);
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
    position = api.applyPlay(position, actionFor(player, selected)).position;
  }
  return scoreState(api, position, payload.view.forPlayer);
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

function response(
  stats,
  payload,
  completed,
  done,
  ruleIds,
  effectiveStrengthInverted,
) {
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
      ruleIds,
      effectiveStrengthInverted,
    },
  };
}

const moduleCache = new Map();
const verifiedSourceCache = new Set();

function ruleModule(value) {
  return (
    value &&
    typeof value === 'object' &&
    value.meta &&
    typeof value.meta === 'object' &&
    value.hooks &&
    typeof value.hooks === 'object'
  );
}

async function loadRuleModules(ruleContext) {
  if (!ruleContext) return [];
  if (ruleContext.ruleChain.length !== ruleContext.bundles.length) {
    throw new Error('AI rule bundle set differs from the fixed rule chain');
  }
  const bundlesById = new Map();
  for (const bundle of ruleContext.bundles) {
    if (bundlesById.has(bundle.ruleId)) {
      throw new Error(`Duplicate AI rule bundle: ${bundle.ruleId}`);
    }
    const url = new URL(bundle.moduleUrl);
    if (url.protocol !== 'file:') {
      throw new Error(`AI rule bundle must be a local file: ${bundle.ruleId}`);
    }
    if (!/^[a-f0-9]{64}$/u.test(bundle.bundleHash)) {
      throw new Error(`AI rule bundle hash must be sha256: ${bundle.ruleId}`);
    }
    const verificationKey = `${bundle.bundleHash}:${bundle.moduleUrl}`;
    if (!verifiedSourceCache.has(verificationKey)) {
      const sourceUrl = new URL(url);
      sourceUrl.search = '';
      sourceUrl.hash = '';
      const actualHash = createHash('sha256')
        .update(await readFile(sourceUrl))
        .digest('hex');
      if (actualHash !== bundle.bundleHash) {
        throw new Error(`AI rule bundle content mismatch: ${bundle.ruleId}`);
      }
      verifiedSourceCache.add(verificationKey);
    }
    bundlesById.set(bundle.ruleId, bundle);
  }
  const modules = [];
  for (const entry of ruleContext.ruleChain) {
    const bundle = bundlesById.get(entry.ruleId);
    if (
      !bundle ||
      bundle.bundleHash !== entry.bundleHash ||
      bundle.contractVersion !== entry.contractVersion ||
      bundle.meta.ruleId !== entry.ruleId ||
      bundle.meta.name !== entry.name ||
      bundle.meta.contractVersion !== entry.contractVersion
    ) {
      throw new Error(`AI rule bundle metadata mismatch: ${entry.ruleId}`);
    }
    const cacheKey = `${bundle.bundleHash}:${bundle.moduleUrl}`;
    let module = moduleCache.get(cacheKey);
    if (!module) {
      const importUrl = new URL(bundle.moduleUrl);
      importUrl.searchParams.set('bundleHash', bundle.bundleHash);
      const loaded = await import(importUrl.href);
      module = loaded.rule;
      if (!ruleModule(module)) {
        throw new Error(`AI rule bundle has no RuleModule: ${entry.ruleId}`);
      }
      moduleCache.set(cacheKey, module);
    }
    if (
      module.meta.ruleId !== entry.ruleId ||
      module.meta.contractVersion !== entry.contractVersion ||
      !isDeepStrictEqual(module.meta, bundle.meta)
    ) {
      throw new Error(`AI rule module contract mismatch: ${entry.ruleId}`);
    }
    modules.push(module);
  }
  return modules;
}

async function search(payload, onProgress) {
  if (payload.config.maxTreeDepth !== 1) {
    throw new Error('AI-01 supports maxTreeDepth=1 only');
  }
  const modules = await loadRuleModules(payload.ruleContext);
  const ruleChain = structuredClone(payload.ruleContext?.ruleChain ?? []);
  let ruleIssue;
  const port = core.createInProcessRuleChainPort(modules, {
    onIssue(issue) {
      ruleIssue ??= issue;
    },
  });
  const throwIfRuleFailed = () => {
    if (ruleIssue) {
      throw new Error(
        `AI rule execution failed: ${ruleIssue.ruleId}/${ruleIssue.hook}/${ruleIssue.reason}`,
      );
    }
  };
  const config = gameConfig(
    payload.view,
    payload.ruleContext?.gameSeed ?? payload.seed,
    ruleChain,
  );
  const api = core.createSimulationApi({
    config,
    snapshotContext: snapshotContext(payload.view),
    runtime: {
      port,
      setHistory: structuredClone(payload.view.setResults),
      setMemory: structuredClone(payload.ruleContext?.setMemory ?? {}),
    },
  });
  const engineFeatures = core.engineFeaturesOf(ruleChain);
  const sample = determinize(payload.view, payload.seed, -1, engineFeatures);
  sample.private.memory = structuredClone(
    payload.ruleContext?.gameMemory ?? {},
  );
  sample.private.hookCalls = structuredClone(
    payload.ruleContext?.hookCalls ?? {},
  );
  const strength = api.getEffectiveStrengthOrder(api.createPosition(sample));
  throwIfRuleFailed();
  const effectiveStrengthInverted =
    strength.ranking.join(',') ===
    [...core.BASE_STRENGTH_ORDER.ranking].reverse().join(',');
  const scaled = Math.floor(
    payload.budget.maxPlayouts * payload.difficulty.budgetScale,
  );
  const softLimit = Math.max(
    1,
    Math.floor(payload.budget.softMs / CALIBRATED_MS_PER_PLAYOUT),
  );
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
    const world = determinize(
      payload.view,
      payload.seed,
      completed,
      engineFeatures,
    );
    world.private.memory = structuredClone(
      payload.ruleContext?.gameMemory ?? {},
    );
    world.private.hookCalls = structuredClone(
      payload.ruleContext?.hookCalls ?? {},
    );
    const reward = rollout(
      api,
      world,
      stats[candidateIndex].play,
      payload,
      completed,
    );
    throwIfRuleFailed();
    stats[candidateIndex].visits += 1;
    stats[candidateIndex].reward += reward;
    const count = completed + 1;
    const now = performance.now();
    if (
      count === 1 ||
      count % progressBatch === 0 ||
      now - lastProgressAt >= payload.budget.sliceMs
    ) {
      onProgress(
        response(
          stats,
          payload,
          count,
          false,
          ruleChain.map((entry) => entry.ruleId),
          effectiveStrengthInverted,
        ),
      );
      lastProgressAt = now;
    }
  }
  return response(
    stats,
    payload,
    completed,
    completed === target,
    ruleChain.map((entry) => entry.ruleId),
    effectiveStrengthInverted,
  );
}

if (!parentPort) {
  throw new Error('AI worker must run inside worker_threads');
}

parentPort.postMessage({ kind: 'ready' });

parentPort.on('message', async (message) => {
  try {
    parentPort.postMessage({
      kind: 'result',
      id: message.id,
      value: await search(message.payload, (value) => {
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
