import type { CSSProperties, ReactNode } from 'react';

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

/**
 * ワイヤー画面 3 の手札。
 * 横スクロールはしない。実際の手札と同じく左から重ね、枚数が増えるほど
 * 重なりを深くして必ず画面幅に収める。見えているのは各札の左端の帯だけだが、
 * ランクとスートはそこに置いてある(Card の index)。
 */
export function HandTray({
  cards,
  selectedIds,
  onToggle,
  actions,
}: HandTrayProps) {
  return (
    <section className={styles.tray} aria-label="あなたの手札">
      <ul
        className={styles.cards}
        style={{ '--count': cards.length } as CSSProperties}
      >
        {cards.map((card) => (
          <li key={card.id} className={styles.slot}>
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
