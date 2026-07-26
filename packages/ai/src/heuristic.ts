import type { Play, StrengthOrder } from '@daifugo/core';

const BASE_RANKING = [
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'J',
  'Q',
  'K',
  'A',
  '2',
] as const;

function cardIds(play: Play): string[] {
  return play.cards.map((card) => card.id).sort();
}

export function sameCandidate(left: Play, right: Play): boolean {
  if (left.kind !== right.kind || left.count !== right.count) {
    return false;
  }
  const leftIds = cardIds(left);
  const rightIds = cardIds(right);
  return leftIds.every((id, index) => id === rightIds[index]);
}

export function sortPlaysWeakFirst(
  plays: readonly Play[],
  strength: StrengthOrder,
): Play[] {
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

export function weakestPlay(plays: readonly Play[], inverted = false): Play {
  const ranking = inverted ? [...BASE_RANKING].reverse() : [...BASE_RANKING];
  const selected = sortPlaysWeakFirst(plays, { ranking })[0];
  if (!selected) {
    throw new Error('AI cannot choose from an empty legal-play list');
  }
  return selected;
}
