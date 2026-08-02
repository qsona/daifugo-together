import type { CardId } from '../cards/card.js';
import type { RuleId } from '../game/types.js';
import type { Effect, PriorityKey, RuleChainEntry } from '../rules/contract.js';
import type { EffectHook } from '../rules/chain.js';

export type Resolution =
  | { status: 'adopted' }
  | { status: 'deduped'; winnerRuleId: RuleId }
  | { status: 'rejected'; winnerRuleId: RuleId }
  | { status: 'superseded' }
  | { status: 'suppressed-announce' };

export interface EffectEmission {
  ruleId: RuleId;
  position: number;
  effectIndex: number;
  effect: Effect;
  resolvedCards?: CardId[];
}

export interface ResolvedEffect extends EffectEmission {
  resolution: Resolution;
  conflictKey: string | null;
}

export interface ResolvedBatch {
  hook: EffectHook;
  entries: ResolvedEffect[];
  applyOrder: number[];
}

export function comparePriority(left: PriorityKey, right: PriorityKey): number {
  if (left.score !== right.score) {
    return right.score - left.score;
  }
  if (left.activatedAt !== right.activatedAt) {
    return left.activatedAt - right.activatedAt;
  }
  return left.ruleId < right.ruleId ? -1 : left.ruleId > right.ruleId ? 1 : 0;
}

export function sortRuleChain(
  entries: readonly RuleChainEntry[],
): RuleChainEntry[] {
  return [...entries]
    .sort((left, right) => comparePriority(left.priority, right.priority))
    .map((entry, position) => ({ ...entry, position }));
}

export function conflictKeyOf(
  ruleId: RuleId,
  effect: Effect,
  resolvedCards: readonly CardId[] = [],
): string | null {
  switch (effect.type) {
    case 'clearField':
      return 'field';
    case 'requestChoice':
      return `choice:${ruleId}`;
    case 'skipTurns':
      return `turn:${effect.player}`;
    case 'reverseTurnOrder':
      return 'turnOrder';
    case 'forceRank':
      return `rank:${effect.player}`;
    case 'moveCards':
      return `cards:${[...resolvedCards].sort().join(',')}`;
    case 'setMemory':
      return `memory:${ruleId}:${effect.key}`;
    case 'announce':
      return null;
    default: {
      const exhaustive: never = effect;
      return exhaustive;
    }
  }
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalize);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalize(nested)]),
    );
  }
  return value;
}

function samePayload(left: Effect, right: Effect): boolean {
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function intersects(
  left: readonly CardId[],
  right: readonly CardId[],
): boolean {
  const rightIds = new Set(right);
  return left.some((cardId) => rightIds.has(cardId));
}

function moveGroups(entries: readonly EffectEmission[]): number[][] {
  const moveIndices = entries.flatMap((entry, index) =>
    entry.effect.type === 'moveCards' ? [index] : [],
  );
  const parent = new Map(moveIndices.map((index) => [index, index]));
  const find = (value: number): number => {
    const current = parent.get(value);
    if (current === undefined || current === value) {
      return value;
    }
    const root = find(current);
    parent.set(value, root);
    return root;
  };
  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) {
      parent.set(rightRoot, leftRoot);
    }
  };
  moveIndices.forEach((left, leftOffset) => {
    for (
      let rightOffset = leftOffset + 1;
      rightOffset < moveIndices.length;
      rightOffset += 1
    ) {
      const right = moveIndices[rightOffset];
      if (
        right !== undefined &&
        intersects(
          entries[left]?.resolvedCards ?? [],
          entries[right]?.resolvedCards ?? [],
        )
      ) {
        union(left, right);
      }
    }
  });
  return [...Map.groupBy(moveIndices, (index) => find(index)).values()];
}

export function resolveEffectBatch(
  hook: EffectHook,
  emissions: readonly EffectEmission[],
): ResolvedBatch {
  const entries: ResolvedEffect[] = emissions.map((emission) => ({
    ...emission,
    conflictKey: conflictKeyOf(
      emission.ruleId,
      emission.effect,
      emission.resolvedCards,
    ),
    resolution: { status: 'adopted' },
  }));

  const latestWithinRule = new Map<string, number>();
  entries.forEach((entry, index) => {
    if (entry.effect.type === 'moveCards' || entry.conflictKey === null) {
      return;
    }
    const key = `${entry.ruleId}:${entry.conflictKey}`;
    const previous = latestWithinRule.get(key);
    if (previous !== undefined) {
      entries[previous] = {
        ...entries[previous]!,
        resolution: { status: 'superseded' },
      };
    }
    latestWithinRule.set(key, index);
  });

  const staticGroups = Map.groupBy(
    entries.flatMap((entry, index) =>
      entry.conflictKey !== null &&
      entry.effect.type !== 'moveCards' &&
      entry.resolution.status !== 'superseded'
        ? [index]
        : [],
    ),
    (index) => entries[index]!.conflictKey,
  );
  for (const indices of staticGroups.values()) {
    const sorted = [...indices].sort(
      (left, right) =>
        entries[left]!.position - entries[right]!.position ||
        entries[left]!.effectIndex - entries[right]!.effectIndex,
    );
    const winnerIndex = sorted[0];
    const winner = winnerIndex === undefined ? undefined : entries[winnerIndex];
    if (!winner) {
      continue;
    }
    for (const index of sorted.slice(1)) {
      const entry = entries[index]!;
      entries[index] = {
        ...entry,
        resolution: samePayload(entry.effect, winner.effect)
          ? { status: 'deduped', winnerRuleId: winner.ruleId }
          : { status: 'rejected', winnerRuleId: winner.ruleId },
      };
    }
  }

  for (const indices of moveGroups(entries)) {
    const winner = [...indices]
      .map((index) => entries[index]!)
      .sort(
        (left, right) =>
          left.position - right.position ||
          left.effectIndex - right.effectIndex,
      )[0];
    if (!winner) {
      continue;
    }
    const groupCards = [
      ...new Set(
        indices.flatMap((index) => entries[index]!.resolvedCards ?? []),
      ),
    ].sort();
    const conflictKey = `cards:${groupCards.join(',')}`;
    for (const index of indices) {
      const entry = entries[index]!;
      entries[index] = {
        ...entry,
        conflictKey,
        resolution:
          entry.ruleId === winner.ruleId
            ? { status: 'adopted' }
            : { status: 'rejected', winnerRuleId: winner.ruleId },
      };
    }
  }

  const byRule = Map.groupBy(entries, (entry) => entry.ruleId);
  for (const ruleEntries of byRule.values()) {
    const nonAnnounce = ruleEntries.filter(
      (entry) => entry.effect.type !== 'announce',
    );
    const hasRealizedEffect = nonAnnounce.some((entry) =>
      ['adopted', 'deduped'].includes(entry.resolution.status),
    );
    for (const entry of ruleEntries) {
      if (
        entry.effect.type === 'announce' &&
        nonAnnounce.length > 0 &&
        !hasRealizedEffect
      ) {
        entry.resolution = { status: 'suppressed-announce' };
      }
    }
  }

  const applyOrder = entries
    .flatMap((entry, index) =>
      entry.resolution.status === 'adopted' ? [index] : [],
    )
    .sort(
      (left, right) =>
        entries[left]!.position - entries[right]!.position ||
        entries[left]!.effectIndex - entries[right]!.effectIndex,
    );
  return { hook, entries, applyOrder };
}
