import { cx } from '../lib/cx';

import { Card } from './Card';
import type { CardView } from './Card';
import styles from './Table.module.css';

/** 卓に着いている 1 人。席の情報と、その人がこの場に出した札をまとめて持つ。 */
export type TableSeat = {
  name: string;
  isSelf: boolean;
  handCount: number;
  isCurrentTurn: boolean;
  hasPassed: boolean;
  /** 各要素が 1 回のプレイ。場が流れるまで自分の山に積み上がる。 */
  plays: readonly (readonly CardView[])[];
};

/** 自分から時計回りに 4 席。位置がそのまま手番の回る順になる。 */
const POSITIONS = ['bottom', 'left', 'top', 'right'] as const;

type TableProps = {
  /** 自分を先頭に、手番が回る順(時計回り)で 4 人。 */
  seats: readonly TableSeat[];
  /** いま超えるべきプレイの持ち主。場が流れていれば null。 */
  leadSeatName: string | null;
  isFlushing?: boolean;
};

/**
 * 画面 3 の卓。相手席の行と場を 1 つにまとめたもの。
 *
 * 席を菱形に置くことで、手番が時計回りに回ることを文字なしで示す。
 * 出した札はその人の山に重なるので「誰が何を出したか」が常に見えていて、
 * 文字の実況ログを置かなくてよい。
 */
export function Table({ seats, leadSeatName, isFlushing = false }: TableProps) {
  return (
    <section
      className={cx(styles.table, isFlushing && styles.flushing)}
      aria-label="卓"
    >
      {/* preserveAspectRatio=none: 卓は横長なので、輪も卓の比率に合わせて潰す。 */}
      <div className={styles.diamond}>
        <svg
          className={styles.flow}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <ellipse
            cx="50"
            cy="50"
            rx="26"
            ry="23"
            fill="none"
            stroke="var(--color-green-500)"
            strokeWidth="1"
            strokeDasharray="2 3"
            vectorEffect="non-scaling-stroke"
          />
          {/* 時計回りを示す三角。上・右・下・左の順に進む向きを向く。 */}
          <g fill="var(--color-green-500)">
            <path d="M50 20 l3 2 l-3 2 z" />
            <path d="M83 50 l-2 3 l-2 -3 z" />
            <path d="M50 80 l-3 -2 l3 -2 z" />
            <path d="M17 50 l2 -3 l2 3 z" />
          </g>
        </svg>
        {seats.map((seat, index) => {
          const position = POSITIONS[index] ?? 'bottom';
          const cards = seat.plays.flat();

          return (
            <div
              key={seat.name}
              className={cx(
                styles.seat,
                styles[position],
                seat.isCurrentTurn && styles.turn,
                seat.hasPassed && styles.passed,
                seat.name === leadSeatName && styles.lead,
              )}
            >
              <span className={styles.chip}>
                <span className={styles.name}>
                  {seat.isSelf ? 'あなた' : seat.name}
                </span>
                <span className={styles.count}>{seat.handCount}</span>
                {seat.hasPassed && <span className={styles.pass}>パス</span>}
              </span>
              {cards.length === 0 ? (
                <span className={styles.empty} />
              ) : (
                <ul
                  className={styles.pile}
                  aria-label={`${seat.isSelf ? 'あなた' : seat.name}が出した札`}
                >
                  {cards.map((card) => (
                    <li key={card.id}>
                      <Card card={card} size="small" />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
