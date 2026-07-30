import { CARD_RANKS, type CardRank } from '../cards/card.js';

export interface StrengthOrder {
  ranking: CardRank[];
  /**
   * 革命系の永続的な強さ反転が有効かを表す合成シグナル。
   * 省略時は false。一時的な強さ反転はこの値を変更しない。
   */
  revolution?: boolean;
  /**
   * 通常の ranking では表せない、特定の2ランク間だけの強弱例外。
   * 配列の後ろにある指定を優先する。
   */
  comparisonOverrides?: StrengthComparisonOverride[];
}

export interface StrengthComparisonOverride {
  stronger: PlayRank;
  weaker: PlayRank;
}

export const BASE_STRENGTH_ORDER: StrengthOrder = {
  ranking: [...CARD_RANKS],
};

/** Play.repRank の型。'joker' は任意の StrengthOrder で全ランクより強い。 */
export type PlayRank = CardRank | 'joker';

/** ranking 上の位置。'joker' は全ランクより強い (= ranking.length)。 */
export function rankPosition(rank: PlayRank, order: StrengthOrder): number {
  return rank === 'joker' ? order.ranking.length : order.ranking.indexOf(rank);
}

export function compareRanks(
  left: PlayRank,
  right: PlayRank,
  order: StrengthOrder,
): number {
  for (
    let index = (order.comparisonOverrides?.length ?? 0) - 1;
    index >= 0;
    index -= 1
  ) {
    const override = order.comparisonOverrides?.[index];
    if (!override) continue;
    if (left === override.stronger && right === override.weaker) {
      return 1;
    }
    if (left === override.weaker && right === override.stronger) {
      return -1;
    }
  }
  return rankPosition(left, order) - rankPosition(right, order);
}
