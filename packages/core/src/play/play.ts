import { sortCards, type Card, type CardId } from '../cards/card.js';

export type PlayKind = 'single' | 'set';

export interface Play {
  kind: PlayKind;
  cards: Card[];
  count: number;
  repRank: Card['rank'];
}

export type PlayInterpretation =
  | { ok: true; play: Play }
  | { ok: false; code: 'CARD_NOT_IN_HAND' | 'INVALID_PLAY_SHAPE' };

export function interpretPlay(
  hand: readonly Card[],
  cardIds: readonly CardId[],
): PlayInterpretation {
  if (cardIds.length === 0 || cardIds.length > 4) {
    return { ok: false, code: 'INVALID_PLAY_SHAPE' };
  }

  const uniqueIds = new Set(cardIds);
  if (uniqueIds.size !== cardIds.length) {
    return { ok: false, code: 'CARD_NOT_IN_HAND' };
  }

  const handById = new Map(hand.map((card) => [card.id, card]));
  const cards = cardIds.map((id) => handById.get(id));
  if (cards.some((card) => card === undefined)) {
    return { ok: false, code: 'CARD_NOT_IN_HAND' };
  }

  const actualCards = sortCards(cards as Card[]);
  if (
    actualCards.length > 1 &&
    actualCards.some((card) => card.rank !== actualCards[0]?.rank)
  ) {
    return { ok: false, code: 'INVALID_PLAY_SHAPE' };
  }

  const repRank = actualCards[0]?.rank;
  if (!repRank) {
    return { ok: false, code: 'INVALID_PLAY_SHAPE' };
  }

  return {
    ok: true,
    play: {
      kind: actualCards.length === 1 ? 'single' : 'set',
      cards: actualCards,
      count: actualCards.length,
      repRank,
    },
  };
}

export function samePlay(left: Play, right: Play): boolean {
  if (left.kind !== right.kind || left.count !== right.count) {
    return false;
  }
  const leftIds = left.cards.map((card) => card.id).sort();
  const rightIds = right.cards.map((card) => card.id).sort();
  return leftIds.every((id, index) => id === rightIds[index]);
}
