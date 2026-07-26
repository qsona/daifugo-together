import { cx } from '../lib/cx';

import { Tag } from './Tag';
import styles from './RankRow.module.css';

/** 順位行が表示する内容だけを持つ view-model。 */
export type RankView = {
  place: number;
  name: string;
  kind: 'human' | 'ai';
  /** 大富豪・富豪・貧民・大貧民など。 */
  title?: string;
  /**
   * セット内の各戦の順位(古い順)。セットリザルトでのみ渡す。
   * 「3 戦の総合結果である」ことを見出しの文ではなくデータ自身に語らせる。
   */
  history?: readonly number[];
};

export function RankRows({ ranks }: { ranks: readonly RankView[] }) {
  return (
    <ol className={styles.rows}>
      {ranks.map((rank) => (
        <li
          key={rank.name}
          className={cx(styles.row, rank.place === 1 && styles.top)}
        >
          <span className={styles.place}>{rank.place}</span>
          <span className={styles.name}>
            {rank.name}
            {rank.history && (
              <small className={styles.history}>{rank.history.join('→')}</small>
            )}
          </span>
          {rank.title && <span className={styles.title}>{rank.title}</span>}
          <Tag variant={rank.kind}>{rank.kind === 'human' ? '人間' : 'AI'}</Tag>
        </li>
      ))}
    </ol>
  );
}
