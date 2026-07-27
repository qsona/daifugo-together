import { cx } from '../lib/cx';
import { prefersReducedMotion } from '../lib/prefers-reduced-motion';

import styles from './Confetti.module.css';

/** 紙の色。KV の 4 色を順に回す。 */
const COLORS = ['red', 'green', 'blue', 'gold'] as const;
const PIECES = 24;

/**
 * 1 位の発表に添える紙吹雪。装飾なので支援技術には出さない。
 * 散り方は index から決めていて、描き直しても同じところに降る。
 */
export function Confetti() {
  if (prefersReducedMotion()) return null;
  return (
    <div className={styles.field} aria-hidden="true">
      {Array.from({ length: PIECES }, (_, index) => (
        <span
          key={index}
          className={cx(styles.piece, styles[COLORS[index % COLORS.length]!])}
          style={{
            left: `${String((index * 37) % 100)}%`,
            animationDelay: `${String((index % 8) * 120)}ms`,
            animationDuration: `${String(1_600 + (index % 5) * 220)}ms`,
          }}
        />
      ))}
    </div>
  );
}
