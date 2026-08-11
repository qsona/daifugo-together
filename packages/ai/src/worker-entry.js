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

const DANGEROUS_LAST_RANKS = new Set(['2', '8', '3']);

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

function dangerousLastCard(card) {
  return card.kind === 'joker' || DANGEROUS_LAST_RANKS.has(card.rank);
}

function leavesOnlyDangerousCards(hand, play) {
  const played = new Set(play.cards.map((card) => card.id));
  const remaining = hand.filter((card) => !played.has(card.id));
  return remaining.length > 0 && remaining.every(dangerousLastCard);
}

function policyPlays(plays, hand, strength) {
  const safe = plays.filter((play) => !leavesOnlyDangerousCards(hand, play));
  return sortWeakFirst(safe.length > 0 ? safe : plays, strength);
}

function rootPolicyPlays(plays, hand, strength) {
  const safe = [];
  const dangerous = [];
  for (const play of plays) {
    (leavesOnlyDangerousCards(hand, play) ? dangerous : safe).push(play);
  }
  return [
    ...sortWeakFirst(safe, strength),
    ...sortWeakFirst(dangerous, strength),
  ];
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
          zones.set(cardId, event.to);
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
      hand = [...view.hand];
    } else {
      const known = [...zones]
        .filter(([, zone]) => zone.kind === 'hand' && zone.player === player.id)
        .map(([cardId]) => deck.get(cardId));
      const unknownCount = player.handCount - known.length;
      if (unknownCount < 0) {
        throw new Error(`AI observed too many cards in ${player.id}'s hand`);
      }
      hand = [...known, ...shuffled.cards.slice(offset, offset + unknownCount)];
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
        ...(view.field ? { current: view.field } : {}),
        passedSinceLastPlay: [...view.passedSinceLastPlay],
      },
      discard: publicCards,
      standingsTaken: view.players.flatMap((player) =>
        player.standing === null ? [] : [player.standing],
      ),
      history: view.history,
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

function rollout(api, initialState, rootPlay, payload) {
  let position = api.applyPlay(
    api.createPosition(initialState),
    actionFor(payload.view.forPlayer, rootPlay),
  ).position;
  // cutoffSteps counts the root play so the configured value is the maximum
  // length of the simulated action sequence, not only the replies after it.
  let steps = 1;
  let dangerousPlayFilters = 0;
  while (
    steps < Math.max(1, payload.config.cutoffSteps) &&
    !api.isTerminal(position)
  ) {
    const { state } = position;
    const player = state.public.turn;
    if (!player) {
      break;
    }
    const { plays: legal, strength } = api.enumerateLegalPlaysWithStrength(
      position,
      player,
    );
    if (legal.length === 0) {
      if (!state.public.field.current) {
        break;
      }
      position = api.applyPlay(position, { type: 'pass', player }).position;
      steps += 1;
      continue;
    }
    const preferred = policyPlays(
      legal,
      state.players[player]?.hand ?? [],
      strength,
    );
    if (preferred.length < legal.length) dangerousPlayFilters += 1;
    const selected = preferred[0];
    position = api.applyPlay(position, actionFor(player, selected)).position;
    steps += 1;
  }
  return {
    reward: scoreState(api, position, payload.view.forPlayer),
    steps,
    dangerousPlayFilters,
  };
}

function strongestCandidate(stats) {
  return stats
    .map((entry, index) => ({ ...entry, index }))
    .sort(
      (left, right) =>
        right.reward / Math.max(1, right.visits) -
          left.reward / Math.max(1, left.visits) ||
        right.visits - left.visits ||
        left.index - right.index,
    )[0];
}

function response(
  stats,
  worlds,
  candidateEvaluations,
  simulatedSteps,
  dangerousPlayFilters,
  done,
  ruleIds,
  effectiveStrengthInverted,
  setupMs,
  searchStartedAt,
) {
  const selected = strongestCandidate(stats);
  return {
    play: selected.play,
    completed: done,
    stats: {
      playouts: candidateEvaluations,
      worlds,
      rootCandidates: stats.length,
      candidateEvaluations,
      simulatedSteps,
      dangerousPlayFilters,
      setupMs,
      searchMs: performance.now() - searchStartedAt,
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
const verifiedModuleContractCache = new Set();
const rulePlanCache = new Map();

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
    if (!verifiedModuleContractCache.has(cacheKey)) {
      if (
        module.meta.ruleId !== entry.ruleId ||
        module.meta.contractVersion !== entry.contractVersion ||
        !isDeepStrictEqual(module.meta, bundle.meta)
      ) {
        throw new Error(`AI rule module contract mismatch: ${entry.ruleId}`);
      }
      verifiedModuleContractCache.add(cacheKey);
    }
    modules.push(module);
  }
  return modules;
}

function rulePlanKey(ruleContext) {
  return (ruleContext?.ruleChain ?? [])
    .map((entry) => `${entry.ruleId}:${entry.bundleHash}:${entry.position}`)
    .join('|');
}

async function search(payload, deadlineAt, onProgress) {
  const searchStartedAt = performance.now();
  if (payload.config.maxTreeDepth !== 1) {
    throw new Error('AI-01 supports maxTreeDepth=1 only');
  }
  const modules = await loadRuleModules(payload.ruleContext);
  const ruleChain = payload.ruleContext?.ruleChain ?? [];
  const planKey = rulePlanKey(payload.ruleContext);
  let rulePlan = rulePlanCache.get(planKey);
  if (!rulePlan) {
    rulePlan = core.compileTrustedSimulationRulePlan(ruleChain, modules);
    rulePlanCache.set(planKey, rulePlan);
  }
  const port = core.createTrustedSimulationRuleChainPort(rulePlan);
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
      setHistory: payload.view.setResults,
      setMemory: payload.ruleContext?.setMemory ?? {},
    },
  });
  const engineFeatures = core.engineFeaturesOf(ruleChain);
  const sample = determinize(payload.view, payload.seed, -1, engineFeatures);
  sample.private.memory = payload.ruleContext?.gameMemory ?? {};
  sample.private.hookCalls = payload.ruleContext?.hookCalls ?? {};
  const strength = api.getEffectiveStrengthOrder(api.createPosition(sample));
  const effectiveStrengthInverted =
    strength.ranking.join(',') ===
    [...core.BASE_STRENGTH_ORDER.ranking].reverse().join(',');
  const scaled = Math.floor(
    payload.budget.maxPlayouts * payload.difficulty.budgetScale,
  );
  const candidates = rootPolicyPlays(
    payload.legalPlays,
    payload.view.hand,
    strength,
  );
  const evaluationLimit = Math.max(candidates.length, scaled);
  const configuredWorlds = Math.max(
    1,
    Math.floor(evaluationLimit / candidates.length),
  );
  const softBudgetWorlds = Math.max(
    1,
    Math.floor(payload.budget.softMs / Math.max(1, payload.budget.sliceMs)),
  );
  const ruleCostDivisor = Math.max(1, Math.ceil(ruleChain.length / 4));
  const targetWorlds = Math.max(
    1,
    Math.floor(Math.min(configuredWorlds, softBudgetWorlds) / ruleCostDivisor),
  );
  const stats = candidates.map((play) => ({
    play,
    visits: 0,
    reward: 0,
  }));
  const setupMs = performance.now() - searchStartedAt;
  const cooperativeDeadlineAt =
    deadlineAt - Math.max(25, payload.budget.sliceMs * 2);
  let worlds = 0;
  let candidateEvaluations = 0;
  let simulatedSteps = 0;
  let dangerousPlayFilters = 0;
  for (let worldIndex = 0; worldIndex < targetWorlds; worldIndex += 1) {
    if (worldIndex > 0 && Date.now() >= cooperativeDeadlineAt) break;
    const world = determinize(
      payload.view,
      payload.seed,
      worldIndex,
      engineFeatures,
    );
    world.private.memory = payload.ruleContext?.gameMemory ?? {};
    world.private.hookCalls = payload.ruleContext?.hookCalls ?? {};
    const round = [];
    for (const entry of stats) {
      if (worldIndex > 0 && Date.now() >= cooperativeDeadlineAt) break;
      round.push(rollout(api, world, entry.play, payload));
    }
    if (round.length !== stats.length) break;
    for (const [index, result] of round.entries()) {
      stats[index].visits += 1;
      stats[index].reward += result.reward;
      simulatedSteps += result.steps;
      dangerousPlayFilters += result.dangerousPlayFilters;
    }
    worlds += 1;
    candidateEvaluations += stats.length;
    onProgress(
      response(
        stats,
        worlds,
        candidateEvaluations,
        simulatedSteps,
        dangerousPlayFilters,
        false,
        ruleChain.map((entry) => entry.ruleId),
        effectiveStrengthInverted,
        setupMs,
        searchStartedAt,
      ),
    );
  }
  if (worlds === 0) {
    throw new Error('AI search could not complete one candidate round');
  }
  return response(
    stats,
    worlds,
    candidateEvaluations,
    simulatedSteps,
    dangerousPlayFilters,
    worlds === targetWorlds,
    ruleChain.map((entry) => entry.ruleId),
    effectiveStrengthInverted,
    setupMs,
    searchStartedAt,
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
      value: await search(message.payload, message.deadlineAt, (value) => {
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
