import { cx } from '../lib/cx';

import { Tag } from './Tag';
import styles from './SetRankRows.module.css';

/** セット総合の順位が表示する内容だけを持つ view-model。 */
export type SetRankView = {
  place: number;
  name: string;
  kind: 'human' | 'ai';
  /** 大富豪・富豪・貧民・大貧民。 */
  title?: string;
  /** セット(3 戦)の合計順位点。 */
  totalPoints: number;
  isYou?: boolean;
};

/**
 * セットリザルトの順位。1 位だけ花形カードにして、2 位以下は 1 行ずつ。
 * 各戦の内訳は直前の最終戦リザルトが見せているので、ここは合計点だけを言う。
 */
export function SetRankRows({ ranks }: { ranks: readonly SetRankView[] }) {
  const champion = ranks.find((rank) => rank.place === 1);
  const rest = ranks.filter((rank) => rank.place !== 1);
  return (
    <div className={styles.wrap}>
      {champion && (
        <div className={cx(styles.champion, champion.isYou && styles.you)}>
          <span className={styles.crown}>{champion.place}位</span>
          {champion.title && (
            <span className={styles.championTitle}>{champion.title}</span>
          )}
          <span className={styles.championName}>{champion.name}</span>
          <span className={styles.championScore}>
            {String(champion.totalPoints)}点
          </span>
          <Tag variant={champion.kind}>
            {champion.kind === 'human' ? '人間' : 'AI'}
          </Tag>
        </div>
      )}
      <ol className={styles.rows}>
        {rest.map((rank) => (
          <li
            key={rank.name}
            className={cx(styles.row, rank.isYou && styles.you)}
          >
            <span className={styles.place}>{rank.place}</span>
            <span className={styles.name}>{rank.name}</span>
            {rank.title && <span className={styles.title}>{rank.title}</span>}
            {/* 合計点。数字だけで足りるので「合計」の見出し語は置かない。 */}
            <span className={styles.score}>{String(rank.totalPoints)}点</span>
            <Tag variant={rank.kind}>
              {rank.kind === 'human' ? '人間' : 'AI'}
            </Tag>
          </li>
        ))}
      </ol>
    </div>
  );
}
