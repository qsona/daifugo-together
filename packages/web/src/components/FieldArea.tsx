import { Card } from './Card';
import type { CardView } from './Card';
import styles from './FieldArea.module.css';

/** ワイヤー画面 3 の場。いま場に出ている札を見せるだけの表示部品。 */
export function FieldArea({ cards }: { cards: readonly CardView[] }) {
  return (
    <section className={styles.field} aria-label="場">
      <span className={styles.label}>場</span>
      {cards.length === 0 ? (
        <p className={styles.empty}>場は流れています</p>
      ) : (
        <ul className={styles.cards}>
          {cards.map((card) => (
            <li key={card.id}>
              <Card card={card} size="small" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
