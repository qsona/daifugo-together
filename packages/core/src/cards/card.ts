import type { EngineFeature } from '../rules/contract.js';

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

export interface NaturalCard {
  kind: 'natural';
  id: CardId;
  suit: Suit;
  rank: CardRank;
}

export interface JokerCard {
  kind: 'joker';
  id: CardId;
  index: 0 | 1;
}

export type Card = NaturalCard | JokerCard;

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

export const JOKER_IDS = ['JK0', 'JK1'] as const;

export function isJoker(card: Card): card is JokerCard {
  return card.kind === 'joker';
}

export function createDeck(features: readonly EngineFeature[] = []): Card[] {
  const deck: Card[] = SUITS.flatMap((suit) =>
    CARD_RANKS.map((rank) => ({
      kind: 'natural' as const,
      id: `${SUIT_CODES[suit]}${RANK_CODES[rank]}`,
      suit,
      rank,
    })),
  );
  if (features.includes('jokers')) {
    deck.push(
      { kind: 'joker', id: JOKER_IDS[0], index: 0 },
      { kind: 'joker', id: JOKER_IDS[1], index: 1 },
    );
  }
  return deck;
}

export function compareCards(left: Card, right: Card): number {
  if (left.kind === 'joker' || right.kind === 'joker') {
    if (left.kind === 'joker' && right.kind === 'joker') {
      return left.index - right.index;
    }
    return left.kind === 'joker' ? 1 : -1;
  }
  const rankDifference =
    CARD_RANKS.indexOf(left.rank) - CARD_RANKS.indexOf(right.rank);
  return rankDifference === 0
    ? SUITS.indexOf(left.suit) - SUITS.indexOf(right.suit)
    : rankDifference;
}

export function sortCards(cards: readonly Card[]): Card[] {
  return [...cards].sort(compareCards);
}
