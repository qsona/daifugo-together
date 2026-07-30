import { cx } from '../lib/cx';

import styles from './Card.module.css';

export type Suit = 'spade' | 'heart' | 'diamond' | 'club';

/** 1 枚の札が表示する内容だけを持つ view-model(エンジンの Card 型は写さない)。 */
export type CardView = {
  id: string;
  /** ジョーカーは suit を持たない(KV と同じ金の星 + 赤い JOKER で描く)。 */
  suit?: Suit;
  /** 表示上のランク文字列(A・2・…・K、ジョーカーは JOKER)。強さの順序はエンジン側の関心。 */
  rank: string;
  /**
   * 読み上げ用の札名。省略時は suit+rank(suit なしは「ジョーカー」)。
   * ジョーカー 2 枚を支援技術で区別するために使う(例:「ジョーカー1」)。
   */
  label?: string;
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

/**
 * ジョーカーの星。KV 2A(タイトル画面)のジョーカー札と同じ多角形をそのまま使う。
 * 金地・紺の輪郭・角の丸い継ぎ目まで揃えて、タイトルと盤面で同じ札に見えるようにする。
 */
const JOKER_STAR_POINTS =
  '0,-92 13,-52 55,-52 21,-27 34,14 0,-11 -34,14 -21,-27 -55,-52 -13,-52';

function JokerStar({ className }: { className: string | undefined }) {
  return (
    <svg
      className={className}
      viewBox="-58 -95 116 112"
      aria-hidden="true"
      focusable="false"
    >
      <polygon points={JOKER_STAR_POINTS} strokeLinejoin="round" />
    </svg>
  );
}

type CardProps = {
  card: CardView;
  size?: 'medium' | 'small';
  selected?: boolean;
  dimmed?: boolean;
  onToggle?: (id: string) => void;
  onDimmedTap?: (id: string) => void;
};

export function Card({
  card,
  size = 'medium',
  selected,
  dimmed = false,
  onToggle,
  onDimmedTap,
}: CardProps) {
  const isRed = card.suit === 'heart' || card.suit === 'diamond';
  const label =
    card.label ??
    (card.suit ? `${suitName[card.suit]}の${card.rank}` : 'ジョーカー');
  const className = cx(
    styles.card,
    isRed ? styles.red : styles.black,
    size === 'small' && styles.small,
    onToggle && styles.selectable,
    selected && styles.selected,
    dimmed && styles.dimmed,
  );

  /*
   * ランクとスートは左上の隅に置く。手札は左から重ねるので、
   * 各札の見えている部分は左端の細い帯だけになる。そこに情報を集めておけば
   * 扇状に重なっていても全部の札が読める(カードゲーム UI の定石)。
   */
  const index = card.suit ? (
    <span className={styles.index} aria-hidden="true">
      <span className={styles.rank}>{card.rank}</span>
      <span className={styles.suit}>{suitGlyph[card.suit]}</span>
    </span>
  ) : (
    /*
     * ジョーカーの左端の帯は星 1 つだけにする。文字を縦に積むと帯の幅
     * (重ねた札で 15px 前後)で潰れて読めなくなるが、記号なら潰れない。
     */
    <span className={cx(styles.index, styles.jokerIndex)} aria-hidden="true">
      <JokerStar className={styles.jokerIndexStar} />
    </span>
  );

  /*
   * 面が見えているジョーカーは KV と同じ構図(大きな金の星 + 赤い JOKER)で描く。
   * 重なって隠れても左端の星だけで識別できるので、ここは読みやすさ優先で大きく取る。
   */
  const face = card.suit ? (
    index
  ) : (
    <>
      {index}
      <span className={styles.jokerFace} aria-hidden="true">
        <JokerStar className={styles.jokerFaceStar} />
        <span className={styles.jokerWord}>{card.rank}</span>
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
      aria-disabled={dimmed || undefined}
      onAnimationEnd={(event) => {
        const rejectedClass = styles.rejected;
        if (rejectedClass) {
          event.currentTarget.classList.remove(rejectedClass);
        }
      }}
      onClick={(event) => {
        if (dimmed) {
          const target = event.currentTarget;
          const rejectedClass = styles.rejected;
          if (rejectedClass) {
            target.classList.remove(rejectedClass);
            void target.offsetWidth;
            target.classList.add(rejectedClass);
          }
          onDimmedTap?.(card.id);
          return;
        }
        onToggle(card.id);
      }}
    >
      {face}
    </button>
  );
}
