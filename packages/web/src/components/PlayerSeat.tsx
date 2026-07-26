import { cx } from '../lib/cx';

import { Tag } from './Tag';
import styles from './PlayerSeat.module.css';

/** 相手席が表示する内容だけを持つ view-model。手札の中身は持たない(枚数のみ)。 */
export type SeatView = {
  name: string;
  kind: 'human' | 'ai';
  handCount: number;
  isCurrentTurn: boolean;
  hasPassed: boolean;
};

export function PlayerSeats({ seats }: { seats: readonly SeatView[] }) {
  return (
    <ul className={styles.seats}>
      {seats.map((seat) => (
        <li
          key={seat.name}
          className={cx(styles.seat, seat.isCurrentTurn && styles.active)}
        >
          <span className={styles.name}>{seat.name}</span>
          <Tag variant={seat.kind}>{seat.kind === 'human' ? '人間' : 'AI'}</Tag>
          <span className={styles.count}>残り{seat.handCount}枚</span>
          {seat.isCurrentTurn ? (
            <span className={styles.turn}>手番</span>
          ) : seat.hasPassed ? (
            <span className={styles.passed}>パス</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
