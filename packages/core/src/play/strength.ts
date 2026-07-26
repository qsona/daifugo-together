import { CARD_RANKS, type CardRank } from '../cards/card.js';

export interface StrengthOrder {
  ranking: CardRank[];
}

export const BASE_STRENGTH_ORDER: StrengthOrder = {
  ranking: [...CARD_RANKS],
};

export function compareRanks(
  left: CardRank,
  right: CardRank,
  order: StrengthOrder,
): number {
  return order.ranking.indexOf(left) - order.ranking.indexOf(right);
}
