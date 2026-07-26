import styles from './PopularityBar.module.css';

type PopularityBarProps = {
  /** 0〜100。 */
  value: number;
  /** 先頭に「人気度」ラベルを出すか、値側に含めるか。 */
  labelPosition?: 'leading' | 'trailing';
};

/**
 * design-system.html §5-6。
 * バーだけで値を伝えないため、数値ラベルを必ず併記する。
 */
export function PopularityBar({
  value,
  labelPosition = 'leading',
}: PopularityBarProps) {
  const clamped = Math.min(100, Math.max(0, value));

  return (
    <div
      className={styles.popularity}
      role="meter"
      aria-label="人気度"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {labelPosition === 'leading' && <span>人気度</span>}
      <span className={styles.bar}>
        <i className={styles.fill} style={{ width: `${String(clamped)}%` }} />
      </span>
      <span className={styles.value}>
        {labelPosition === 'trailing' ? `人気度 ${String(clamped)}` : clamped}
      </span>
    </div>
  );
}
