import { CARD_RANKS } from '@daifugo/core';
import type {
  Card,
  Play,
  PlayerSnapshot,
  PlayRank,
  StrengthOrder,
} from '@daifugo/core';

const DANGEROUS_LAST_RANKS = new Set(['2', '8', '3']);

function cardIds(play: Play): string[] {
  return play.cards.map((card) => card.id).sort();
}

function singleCardPlay(card: Card): Play {
  return {
    kind: 'single',
    cards: [card],
    count: 1,
    repRank: card.kind === 'joker' ? 'joker' : card.rank,
  };
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

export function leavesOnlyDangerousCards(
  hand: readonly Card[],
  play: Play,
): boolean {
  const played = new Set(play.cards.map((card) => card.id));
  const remaining = hand.filter((card) => !played.has(card.id));
  return (
    remaining.length > 0 &&
    remaining.every(
      (card) => card.kind === 'joker' || DANGEROUS_LAST_RANKS.has(card.rank),
    )
  );
}

export function chooseHeuristicPlay(
  plays: readonly Play[],
  hand: readonly Card[],
  strength: StrengthOrder,
): Play {
  const safe = plays.filter((play) => !leavesOnlyDangerousCards(hand, play));
  const selected = sortPlaysWeakFirst(
    safe.length > 0 ? safe : plays,
    strength,
  )[0];
  if (!selected) {
    throw new Error('AI cannot choose from an empty legal-play list');
  }
  return selected;
}

export function chooseHeuristicPlayForView(
  plays: readonly Play[],
  view: Pick<PlayerSnapshot, 'hand' | 'strengthNote'>,
): Play {
  const ranking = view.strengthNote.inverted
    ? [...CARD_RANKS].reverse()
    : [...CARD_RANKS];
  return chooseHeuristicPlay(plays, view.hand, {
    ranking,
    revolution: view.strengthNote.inverted,
  });
}

export function chooseHeuristicCardIdsForView(
  cards: readonly Card[],
  count: number,
  view: Pick<PlayerSnapshot, 'hand' | 'strengthNote'>,
): string[] {
  const selectableById = new Map(cards.map((card) => [card.id, card]));
  let selectable = [...selectableById.values()];
  let remainingHand = [...view.hand];
  const requested = Number.isSafeInteger(count)
    ? Math.max(0, Math.min(count, selectable.length))
    : 0;
  const strength: StrengthOrder = {
    ranking: view.strengthNote.inverted
      ? [...CARD_RANKS].reverse()
      : [...CARD_RANKS],
    revolution: view.strengthNote.inverted,
  };
  const selected: string[] = [];

  for (let index = 0; index < requested; index += 1) {
    const choice = chooseHeuristicPlay(
      selectable.map(singleCardPlay),
      remainingHand,
      strength,
    ).cards[0]!;
    selected.push(choice.id);
    selectable = selectable.filter((card) => card.id !== choice.id);
    remainingHand = remainingHand.filter((card) => card.id !== choice.id);
  }

  return selected;
}

export function weakestPlay(plays: readonly Play[], inverted = false): Play {
  const ranking = inverted ? [...CARD_RANKS].reverse() : [...CARD_RANKS];
  const selected = sortPlaysWeakFirst(plays, { ranking })[0];
  if (!selected) {
    throw new Error('AI cannot choose from an empty legal-play list');
  }
  return selected;
}
