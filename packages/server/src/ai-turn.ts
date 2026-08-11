import type {
  AiDecision,
  AiFallback,
  AiPlayer,
  AiRuleBundleRef,
  DecideMoveInput,
} from '@daifugo/ai';
import { samePlay, type Play } from '@daifugo/core';

export const AI_WATCHDOG_MS = 1_000;
export const AI_ANIMATION_DELAY = {
  minMs: 400,
  maxMs: 1_200,
} as const;

export interface AiTurnMetric {
  name: 'ai_playouts_per_move' | 'ai_fallback_total' | 'ai_move_wall_ms';
  value: number;
  labels: {
    fallback: AiFallback;
    watchdog: boolean;
  };
}

export interface AiTurnLog {
  event: 'ai_move';
  fallback: AiFallback;
  fallbackReason?: string;
  watchdog: boolean;
  wallMs: number;
  playouts: number;
  worlds: number;
  rootCandidates: number;
  candidateEvaluations: number;
  simulatedSteps: number;
  dangerousPlayFilters: number;
  queueMs: number;
  setupMs: number;
  searchMs: number;
  workerReused: boolean;
  ruleIds: string[];
  animationDelayMs: number;
}

export interface RunAiTurnOptions {
  ai: AiPlayer;
  input: DecideMoveInput;
  fallbackPlay(): Play;
  watchdogMs?: number;
  animationDelay?: {
    minMs: number;
    maxMs: number;
  };
  random?: () => number;
  now?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
  onMetric?: (metric: AiTurnMetric) => void;
  onLog?: (log: AiTurnLog) => void;
}

export interface AiTurnResult {
  decision: AiDecision;
  watchdogTriggered: boolean;
  wallMs: number;
  animationDelayMs: number;
}

export function withResolvedRuleBundles(
  ai: AiPlayer,
  resolveBundles: (
    entries: NonNullable<DecideMoveInput['ruleContext']>['ruleChain'],
  ) => AiRuleBundleRef[],
): AiPlayer {
  return {
    async decideMove(input) {
      if (!input.ruleContext) return ai.decideMove(input);
      const bundles = resolveBundles(input.ruleContext.ruleChain);
      return ai.decideMove({
        ...input,
        ruleContext: {
          ...input.ruleContext,
          bundles,
        },
      });
    },
    close: async () => undefined,
  };
}

type SettledDecision =
  | { kind: 'decision'; decision: AiDecision }
  | { kind: 'failed'; reason: string }
  | { kind: 'watchdog' };

function delayMs(
  range: { minMs: number; maxMs: number },
  random: () => number,
): number {
  if (
    !Number.isFinite(range.minMs) ||
    !Number.isFinite(range.maxMs) ||
    range.minMs < 0 ||
    range.maxMs < range.minMs
  ) {
    throw new Error('Invalid AI animation delay range');
  }
  let sampled: number;
  try {
    sampled = random();
  } catch {
    sampled = 0.5;
  }
  const sample = Number.isFinite(sampled)
    ? Math.max(0, Math.min(1, sampled))
    : 0.5;
  return Math.round(range.minMs + (range.maxMs - range.minMs) * sample);
}

function legalDecision(
  decision: AiDecision,
  legalPlays: readonly Play[],
): boolean {
  return legalPlays.some((play) => samePlay(play, decision.play));
}

function guaranteedFallback(options: RunAiTurnOptions): Play {
  try {
    const proposed = options.fallbackPlay();
    const legal = options.input.legalPlays.find((play) =>
      samePlay(play, proposed),
    );
    if (legal) {
      return legal;
    }
  } catch {
    // The authority fallback is expected to be total. The first known legal
    // play keeps the game moving if an integration violates that contract.
  }
  return options.input.legalPlays[0]!;
}

function defaultSleep(delay: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delay);
  });
}

function emitMetric(
  sink: RunAiTurnOptions['onMetric'],
  metric: AiTurnMetric,
): void {
  try {
    sink?.(metric);
  } catch {
    // Observability must never stop an authoritative game transition.
  }
}

export async function runAiTurn(
  options: RunAiTurnOptions,
): Promise<AiTurnResult> {
  if (options.input.legalPlays.length === 0) {
    throw new Error('Forced pass must be handled before runAiTurn');
  }
  const watchdogMs = options.watchdogMs ?? AI_WATCHDOG_MS;
  if (!Number.isFinite(watchdogMs) || watchdogMs < 0) {
    throw new Error('Invalid AI watchdog duration');
  }
  const now = options.now ?? performance.now.bind(performance);
  const startedAt = now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = await Promise.race<SettledDecision>([
    Promise.resolve()
      .then(() => options.ai.decideMove(options.input))
      .then((decision) => ({ kind: 'decision', decision }) as const)
      .catch(
        (error: unknown) =>
          ({
            kind: 'failed',
            reason: error instanceof Error ? error.message : String(error),
          }) as const,
      ),
    new Promise<SettledDecision>((resolve) => {
      timer = setTimeout(() => resolve({ kind: 'watchdog' }), watchdogMs);
    }),
  ]);
  if (timer !== undefined) {
    clearTimeout(timer);
  }

  const watchdogTriggered = settled.kind === 'watchdog';
  const engineFallbackReason =
    settled.kind === 'watchdog'
      ? 'server-watchdog'
      : settled.kind === 'failed'
        ? `ai-error:${settled.reason}`
        : legalDecision(settled.decision, options.input.legalPlays)
          ? undefined
          : 'ai-returned-illegal-play';
  const decision: AiDecision =
    settled.kind === 'decision' &&
    legalDecision(settled.decision, options.input.legalPlays)
      ? settled.decision
      : {
          play: guaranteedFallback(options),
          usedFallback: 'engine-fallback' as const,
          ...(engineFallbackReason === undefined
            ? {}
            : { fallbackReason: engineFallbackReason }),
          stats: {
            playouts: 0,
            candidates: [],
            workerThread: false,
          },
        };
  const wallMs = Math.max(0, now() - startedAt);
  const animationDelayMs = delayMs(
    options.animationDelay ?? AI_ANIMATION_DELAY,
    options.random ?? Math.random,
  );
  const labels = {
    fallback: decision.usedFallback,
    watchdog: watchdogTriggered,
  };
  emitMetric(options.onMetric, {
    name: 'ai_playouts_per_move',
    value: decision.stats?.playouts ?? 0,
    labels,
  });
  emitMetric(options.onMetric, {
    name: 'ai_move_wall_ms',
    value: wallMs,
    labels,
  });
  if (decision.usedFallback !== 'none') {
    emitMetric(options.onMetric, {
      name: 'ai_fallback_total',
      value: 1,
      labels,
    });
  }
  try {
    options.onLog?.({
      event: 'ai_move',
      fallback: decision.usedFallback,
      ...(decision.fallbackReason === undefined
        ? {}
        : { fallbackReason: decision.fallbackReason }),
      watchdog: watchdogTriggered,
      wallMs,
      playouts: decision.stats?.playouts ?? 0,
      worlds: decision.stats?.worlds ?? 0,
      rootCandidates: decision.stats?.rootCandidates ?? 0,
      candidateEvaluations: decision.stats?.candidateEvaluations ?? 0,
      simulatedSteps: decision.stats?.simulatedSteps ?? 0,
      dangerousPlayFilters: decision.stats?.dangerousPlayFilters ?? 0,
      queueMs: decision.stats?.queueMs ?? 0,
      setupMs: decision.stats?.setupMs ?? 0,
      searchMs: decision.stats?.searchMs ?? 0,
      workerReused: decision.stats?.workerReused ?? false,
      ruleIds: decision.stats?.ruleIds ?? [],
      animationDelayMs,
    });
  } catch {
    // Logging is best effort at this integration boundary.
  }
  try {
    await (options.sleep ?? defaultSleep)(animationDelayMs);
  } catch {
    // A presentation delay failure must not discard the selected legal move.
  }

  return {
    decision,
    watchdogTriggered,
    wallMs,
    animationDelayMs,
  };
}
