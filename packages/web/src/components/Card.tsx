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

  /*
   * ランクとスートは左上の隅に置く。手札は左から重ねるので、
   * 各札の見えている部分は左端の細い帯だけになる。そこに情報を集めておけば
   * 扇状に重なっていても全部の札が読める(カードゲーム UI の定石)。
   */
  const index = (
    <span className={styles.index} aria-hidden="true">
      <span className={styles.rank}>{card.rank}</span>
      <span className={styles.suit}>{suitGlyph[card.suit]}</span>
    </span>
  );

  const face = index;

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
