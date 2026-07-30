import { CARD_RANKS } from '@daifugo/core';
import type { Play, PlayRank, StrengthOrder } from '@daifugo/core';

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

function rankPosition(
  rank: PlayRank,
  rankIndex: ReadonlyMap<string, number>,
): number {
  // 'joker' (および ranking に現れない repRank) はどの StrengthOrder でも
  // 最強として扱う (エンジンの compareRanks と同じ規約)。
  return rankIndex.get(rank) ?? Number.MAX_SAFE_INTEGER;
}

export function sortPlaysWeakFirst(
  plays: readonly Play[],
  strength: StrengthOrder,
): Play[] {
  const rankIndex = new Map<string, number>(
    strength.ranking.map((rank, index) => [rank, index]),
  );
  return [...plays].sort(
    (left, right) =>
      rankPosition(left.repRank, rankIndex) -
        rankPosition(right.repRank, rankIndex) ||
      right.count - left.count ||
      cardIds(left).join(',').localeCompare(cardIds(right).join(',')),
  );
}

export function weakestPlay(plays: readonly Play[], inverted = false): Play {
  const ranking = inverted ? [...CARD_RANKS].reverse() : [...CARD_RANKS];
  const selected = sortPlaysWeakFirst(plays, { ranking })[0];
  if (!selected) {
    throw new Error('AI cannot choose from an empty legal-play list');
  }
  return selected;
}
