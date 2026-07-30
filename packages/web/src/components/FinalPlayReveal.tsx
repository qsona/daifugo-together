import { useId } from 'react';

import { Card } from './Card';
import type { CardView } from './Card';

import styles from './FinalPlayReveal.module.css';

type FinalPlayRevealProps = {
  playerName: string;
  cards: readonly CardView[];
};

/** 対局終了直後に、最後の人が出した手を短時間だけ見せる。 */
export function FinalPlayReveal({ playerName, cards }: FinalPlayRevealProps) {
  const titleId = useId();
  return (
    <div
      className={styles.layer}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <section className={styles.panel}>
        <p className={styles.label}>最後の手</p>
        <h2 id={titleId} className={styles.title}>
          {playerName}があがり!
        </h2>
        <ul className={styles.cards} aria-label={`${playerName}が出した札`}>
          {cards.map((card) => (
            <li key={card.id}>
              <Card card={card} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
