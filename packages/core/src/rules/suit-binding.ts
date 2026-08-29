import type { CardId, Suit } from '../cards/card.js';
import type { PublicGameEvent } from '../game/types.js';
import type { Play } from '../play/play.js';
import type { DeepReadonly } from './contract.js';

const SUITS = ['spade', 'heart', 'diamond', 'club'] as const;

export type SuitBinding = readonly [number, number, number, number];

function naturalSuitCounts(play: DeepReadonly<Play>): SuitBinding {
  const counts: [number, number, number, number] = [0, 0, 0, 0];
  for (const card of play.cards) {
    if (card.kind !== 'natural') continue;
    const index = SUITS.indexOf(card.suit);
    counts[index] = (counts[index] ?? 0) + 1;
  }
  return counts;
}

function sameBinding(
  left: DeepReadonly<SuitBinding>,
  right: DeepReadonly<SuitBinding>,
): boolean {
  return left.every((count, index) => count === right[index]);
}

function containsJoker(play: DeepReadonly<Play>): boolean {
  return play.cards.some((card) => card.kind === 'joker');
}

function sameCardIds(
  event: DeepReadonly<PublicGameEvent>,
  marker: readonly CardId[],
): boolean {
  if (event.type !== 'played') return false;
  const eventIds = event.play.cards.map((card) => card.id).toSorted();
  return (
    eventIds.length === marker.length &&
    eventIds.every((cardId, index) => cardId === marker[index])
  );
}

function eventsAfterReset(
  history: readonly DeepReadonly<PublicGameEvent>[],
  resetAfter: readonly CardId[] | null | undefined,
): readonly DeepReadonly<PublicGameEvent>[] {
  if (resetAfter == null) return history;
  const marker = [...resetAfter].sort();
  const resetIndex = history.findLastIndex((event) =>
    sameCardIds(event, marker),
  );
  return resetIndex < 0 ? [] : history.slice(resetIndex + 1);
}

export function suitBindingFromHistory(
  history: readonly DeepReadonly<PublicGameEvent>[],
  resetAfter: readonly CardId[] | null | undefined = null,
): SuitBinding | null {
  let previous: SuitBinding | null = null;
  let binding: SuitBinding | null = null;

  for (const event of eventsAfterReset(history, resetAfter)) {
    if (event.type === 'fieldCleared') {
      previous = null;
      binding = null;
      continue;
    }
    if (event.type !== 'played') continue;
    if (containsJoker(event.play)) {
      previous = null;
      continue;
    }

    const current = naturalSuitCounts(event.play);
    if (
      binding === null &&
      previous !== null &&
      sameBinding(previous, current)
    ) {
      binding = current;
    }
    previous = current;
  }

  return binding;
}

export function previousPlayForSuitBinding(
  history: readonly DeepReadonly<PublicGameEvent>[],
  resetAfter: readonly CardId[] | null | undefined = null,
): DeepReadonly<Play> | null {
  const events = eventsAfterReset(history, resetAfter);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === 'fieldCleared') return null;
    if (event?.type === 'played') return event.play;
  }
  return null;
}

export function hasSameNaturalSuitSignature(
  left: DeepReadonly<Play>,
  right: DeepReadonly<Play>,
): boolean {
  return sameBinding(naturalSuitCounts(left), naturalSuitCounts(right));
}

function chooseMissingSuits(
  counts: [number, number, number, number],
  remaining: number,
  start: number,
  result: SuitBinding[],
): void {
  if (remaining === 0) {
    result.push(counts);
    return;
  }
  for (let index = start; index < SUITS.length; index += 1) {
    if ((counts[index] ?? 0) !== 0) continue;
    const next = [...counts] as [number, number, number, number];
    next[index] = 1;
    chooseMissingSuits(next, remaining - 1, index + 1, result);
  }
}

function suitOptions(play: DeepReadonly<Play>): SuitBinding[] {
  const counts = [...naturalSuitCounts(play)] as [
    number,
    number,
    number,
    number,
  ];
  const jokerCount = play.cards.filter((card) => card.kind === 'joker').length;
  if (jokerCount === 0) return [counts];

  if (play.kind === 'sequence') {
    const naturalSuitIndexes = counts
      .map((count, index) => (count > 0 ? index : -1))
      .filter((index) => index >= 0);
    if (naturalSuitIndexes.length > 1) return [];
    if (naturalSuitIndexes.length === 1) {
      const index = naturalSuitIndexes[0]!;
      counts[index] = (counts[index] ?? 0) + jokerCount;
      return [counts];
    }
    return SUITS.map((_: Suit, index) => {
      const option: [number, number, number, number] = [0, 0, 0, 0];
      option[index] = jokerCount;
      return option;
    });
  }

  const options: SuitBinding[] = [];
  chooseMissingSuits(counts, jokerCount, 0, options);
  return options;
}

export function playMatchesSuitBinding(
  play: DeepReadonly<Play>,
  binding: DeepReadonly<SuitBinding>,
): boolean {
  return suitOptions(play).some((option) => sameBinding(option, binding));
}
