import type { Card, CardId } from '../cards/card.js';
import type { PlayRank } from './strength.js';

export type PlayKind = 'single' | 'set' | 'sequence';

/** 解釈タイブレーク用の kind 優先順 (single < set < sequence)。 */
export const PLAY_KIND_ORDER: Record<PlayKind, number> = {
  single: 0,
  set: 1,
  sequence: 2,
};

export interface Play {
  kind: PlayKind;
  cards: Card[];
  count: number;
  repRank: PlayRank;
}

export interface PlayCandidateMatch {
  /** generateCandidates が返した配列内の添字。 */
  index: number;
  /** 候補のジョーカーを選択された実カードへ差し替えた Play。 */
  play: Play;
}

export type PlayCandidateMatchResult =
  | { ok: true; matches: PlayCandidateMatch[] }
  | { ok: false; code: 'CARD_NOT_IN_HAND' | 'INVALID_PLAY_SHAPE' };

function substituteJokers(candidate: Play, selectedJokers: Card[]): Play {
  let jokerCursor = 0;
  const cards = candidate.cards.map((card) => {
    if (card.kind !== 'joker') {
      return card;
    }
    const replacement = selectedJokers[jokerCursor];
    jokerCursor += 1;
    if (!replacement) {
      throw new Error('Joker substitution ran out of selected jokers');
    }
    return replacement;
  });
  return { ...candidate, cards };
}

/**
 * 選択カード集合と一致する候補を全て集める。
 *
 * 候補は正規化 (ジョーカーは ID 昇順で選択) されているため、一致判定は
 * 自然カードの ID 集合とジョーカー使用枚数で行い、一致した候補の
 * ジョーカーを選択された実ジョーカー (ID 昇順) へ差し替えて返す。
 */
export function matchPlayCandidates(
  hand: readonly Card[],
  cardIds: readonly CardId[],
  candidates: readonly Play[],
  kind?: PlayKind,
): PlayCandidateMatchResult {
  if (cardIds.length === 0) {
    return { ok: false, code: 'INVALID_PLAY_SHAPE' };
  }
  const uniqueIds = new Set(cardIds);
  if (uniqueIds.size !== cardIds.length) {
    return { ok: false, code: 'CARD_NOT_IN_HAND' };
  }
  const handById = new Map(hand.map((card) => [card.id, card]));
  const selected: Card[] = [];
  for (const id of cardIds) {
    const card = handById.get(id);
    if (!card) {
      return { ok: false, code: 'CARD_NOT_IN_HAND' };
    }
    selected.push(card);
  }
  const selectedNaturalIds = selected
    .filter((card) => card.kind === 'natural')
    .map((card) => card.id)
    .sort();
  const selectedJokers = selected
    .filter((card) => card.kind === 'joker')
    .sort((left, right) => left.id.localeCompare(right.id));
  const selectedKey = selectedNaturalIds.join(',');

  const matches: PlayCandidateMatch[] = [];
  for (const [index, candidate] of candidates.entries()) {
    if (candidate.count !== cardIds.length) {
      continue;
    }
    if (kind !== undefined && candidate.kind !== kind) {
      continue;
    }
    const candidateNaturalIds = candidate.cards
      .filter((card) => card.kind === 'natural')
      .map((card) => card.id)
      .sort();
    const candidateJokerCount = candidate.count - candidateNaturalIds.length;
    if (
      candidateJokerCount !== selectedJokers.length ||
      candidateNaturalIds.join(',') !== selectedKey
    ) {
      continue;
    }
    matches.push({ index, play: substituteJokers(candidate, selectedJokers) });
  }
  if (matches.length === 0) {
    return { ok: false, code: 'INVALID_PLAY_SHAPE' };
  }
  return { ok: true, matches };
}

export function samePlay(left: Play, right: Play): boolean {
  if (left.kind !== right.kind || left.count !== right.count) {
    return false;
  }
  const leftIds = left.cards.map((card) => card.id).sort();
  const rightIds = right.cards.map((card) => card.id).sort();
  return leftIds.every((id, index) => id === rightIds[index]);
}
