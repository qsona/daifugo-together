export const SUITS = ['spade', 'heart', 'diamond', 'club'] as const;
export type Suit = (typeof SUITS)[number];

export const CARD_RANKS = [
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
export type CardRank = (typeof CARD_RANKS)[number];
export type CardId = string;

export interface Card {
  kind: 'natural';
  id: CardId;
  suit: Suit;
  rank: CardRank;
}

const SUIT_CODES: Record<Suit, string> = {
  spade: 'S',
  heart: 'H',
  diamond: 'D',
  club: 'C',
};

const RANK_CODES: Record<CardRank, string> = {
  '3': '03',
  '4': '04',
  '5': '05',
  '6': '06',
  '7': '07',
  '8': '08',
  '9': '09',
  '10': '10',
  J: 'J',
  Q: 'Q',
  K: 'K',
  A: 'A',
  '2': '02',
};

export const DIAMOND_THREE_ID = 'D03';

export function createDeck(): Card[] {
  return SUITS.flatMap((suit) =>
    CARD_RANKS.map((rank) => ({
      kind: 'natural' as const,
      id: `${SUIT_CODES[suit]}${RANK_CODES[rank]}`,
      suit,
      rank,
    })),
  );
}

export function compareCards(left: Card, right: Card): number {
  const rankDifference =
    CARD_RANKS.indexOf(left.rank) - CARD_RANKS.indexOf(right.rank);
  return rankDifference === 0
    ? SUITS.indexOf(left.suit) - SUITS.indexOf(right.suit)
    : rankDifference;
}

export function sortCards(cards: readonly Card[]): Card[] {
  return [...cards].sort(compareCards);
}
