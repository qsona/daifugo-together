import { cx } from '../lib/cx';

import styles from './SegmentedControl.module.css';

type SegmentedControlProps<T extends string> = {
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  /** null は未選択。既定値を選択済みに見せない(評価入力で誤解を生むため)。 */
  value: T | null;
  onChange: (value: T) => void;
  /** mini はセット評価などの 3 分割用。 */
  size?: 'medium' | 'mini';
};

export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  size = 'medium',
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx(styles.segmented, size === 'mini' && styles.mini)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={cx(
            styles.option,
            option.value === value && styles.selected,
          )}
          onClick={() => {
            onChange(option.value);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
