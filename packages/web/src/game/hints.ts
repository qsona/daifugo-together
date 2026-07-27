import type { Play } from '@daifugo/core';

export type CardHint = 'playable' | 'dimmed';

export function deriveCardHints(
  hand: readonly { id: string }[],
  legalMoves: readonly Play[] | null,
  selectedIds: readonly string[],
): Map<string, CardHint> {
  if (legalMoves === null) {
    return new Map(hand.map((card) => [card.id, 'playable']));
  }

  const selected = new Set(selectedIds);
  const candidates =
    selected.size === 0
      ? legalMoves
      : legalMoves.filter((move) => {
          const moveIds = new Set(move.cards.map((card) => card.id));
          return selectedIds.every((id) => moveIds.has(id));
        });
  const playable = new Set(selected);
  for (const move of candidates) {
    for (const card of move.cards) {
      playable.add(card.id);
    }
  }

  return new Map(
    hand.map((card) => [
      card.id,
      playable.has(card.id) ? 'playable' : 'dimmed',
    ]),
  );
}
