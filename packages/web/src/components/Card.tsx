import { cx } from '../lib/cx';

import styles from './Card.module.css';

export type Suit = 'spade' | 'heart' | 'diamond' | 'club';

/** 1 枚の札が表示する内容だけを持つ view-model(エンジンの Card 型は写さない)。 */
export type CardView = {
  id: string;
  suit: Suit;
  /** 表示上のランク文字列(A・2・…・K)。強さの順序はエンジン側の関心。 */
  rank: string;
};

const suitGlyph: Record<Suit, string> = {
  spade: '♠',
  heart: '♥',
  diamond: '♦',
  club: '♣',
};

const suitName: Record<Suit, string> = {
  spade: 'スペード',
  heart: 'ハート',
  diamond: 'ダイヤ',
  club: 'クラブ',
};

type CardProps = {
  card: CardView;
  size?: 'medium' | 'small';
  selected?: boolean;
  onToggle?: (id: string) => void;
};

export function Card({ card, size = 'medium', selected, onToggle }: CardProps) {
  const isRed = card.suit === 'heart' || card.suit === 'diamond';
  const label = `${suitName[card.suit]}の${card.rank}`;
  const className = cx(
    styles.card,
    isRed ? styles.red : styles.black,
    size === 'small' && styles.small,
    onToggle && styles.selectable,
    selected && styles.selected,
  );

  const face = (
    <>
      <span className={styles.rank}>{card.rank}</span>
      <span className={styles.suit} aria-hidden="true">
        {suitGlyph[card.suit]}
      </span>
    </>
  );

  if (!onToggle) {
    return (
      <div className={className} role="img" aria-label={label}>
        {face}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      aria-pressed={selected ?? false}
      onClick={() => {
        onToggle(card.id);
      }}
    >
      {face}
    </button>
  );
}
