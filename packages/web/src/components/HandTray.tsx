import type { ReactNode } from 'react';

import { Card } from './Card';
import type { CardView } from './Card';
import styles from './HandTray.module.css';

type HandTrayProps = {
  cards: readonly CardView[];
  selectedIds: readonly string[];
  onToggle: (id: string) => void;
  /** 出す・パスのボタン。合法手の判定はエンジン側の関心なので props で受ける。 */
  actions?: ReactNode;
};

/** ワイヤー画面 3 の手札。横スクロールで全枚数を収める。 */
export function HandTray({
  cards,
  selectedIds,
  onToggle,
  actions,
}: HandTrayProps) {
  return (
    <section className={styles.tray} aria-label="あなたの手札">
      <div className={styles.head}>
        <span>あなたの手札</span>
        <span>{cards.length}枚</span>
      </div>
      <ul className={styles.cards}>
        {cards.map((card) => (
          <li key={card.id}>
            <Card
              card={card}
              selected={selectedIds.includes(card.id)}
              onToggle={onToggle}
            />
          </li>
        ))}
      </ul>
      {actions && <div className={styles.actions}>{actions}</div>}
    </section>
  );
}
