import { cx } from '../lib/cx';

import { PopularityBar } from './PopularityBar';
import { Tag } from './Tag';
import styles from './RuleCard.module.css';

/** 図鑑行が表示する内容だけを持つ view-model(エンジンの型は写さない)。 */
export type RuleCardView = {
  name: string;
  /** 有効ルールの優先度。排除済みなど順位を持たないときは null。 */
  priority: number | null;
  category: 'local' | 'original';
  /** ローカル区分でも未入力があるので任意。 */
  prefecture?: string;
  originLabel?: string;
  description?: string;
  popularity: number | null;
  status: 'active' | 'removed';
};

export function RuleCard({ rule }: { rule: RuleCardView }) {
  const isRemoved = rule.status === 'removed';

  return (
    <article className={cx(styles.rule, isRemoved && styles.removed)}>
      {rule.priority !== null && (
        <div className={styles.rank}>
          <b className={styles.rankValue}>{rule.priority}</b>
          <small className={styles.rankLabel}>優先</small>
        </div>
      )}
      <div className={styles.main}>
        <h3 className={styles.name}>
          {rule.name}
          <Tag variant={isRemoved ? 'removed' : 'active'}>
            {isRemoved ? '排除済み' : '有効'}
          </Tag>
        </h3>
        {rule.description && (
          <p className={styles.description}>{rule.description}</p>
        )}
        <div className={styles.meta}>
          <Tag variant={rule.prefecture ? 'pref' : rule.category}>
            {rule.originLabel ??
              (rule.category === 'local'
                ? 'ローカル(県の記載なし)'
                : 'オリジナル')}
          </Tag>
        </div>
        {rule.popularity !== null && (
          <PopularityBar value={rule.popularity} labelPosition="trailing" />
        )}
      </div>
    </article>
  );
}

/**
 * 対局・待機画面用のルール行。名称のみで、人気度・都道府県・優先度の数値は出さない
 * (企画書 §4.5「ラフな体験」)。
 */
export function RuleNameList({ names }: { names: readonly string[] }) {
  return (
    <ul className={styles.list}>
      {names.map((name) => (
        <li key={name} className={styles.slim}>
          {name}
        </li>
      ))}
    </ul>
  );
}
