import { cx } from '../lib/cx';

import styles from './MoodPicker.module.css';

/** 口の形。眉や記号は足さず、口だけで 3 段階を読ませる。 */
const MOUTH: Record<string, string> = {
  fun: 'M9 18 Q16 25 23 18',
  neutral: 'M10 19 H22',
  boring: 'M9 22 Q16 15 23 22',
};

type MoodPickerProps<T extends string> = {
  label: string;
  /** 良い順に 3 つ。value は MOUTH のキーと対応させる。 */
  options: ReadonlyArray<{ value: T; label: string }>;
  /** null は未選択。既定値を選択済みに見せない。 */
  value: T | null;
  onChange: (value: T) => void;
};

/**
 * 3 段階の主観評価。文字ラベルを置かず顔で選ばせる。
 * 支援技術には aria-label が元の文言をそのまま伝える。
 */
export function MoodPicker<T extends string>({
  label,
  options,
  value,
  onChange,
}: MoodPickerProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={styles.picker}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          aria-label={option.label}
          className={cx(styles.face, option.value === value && styles.selected)}
          onClick={() => {
            onChange(option.value);
          }}
        >
          <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
            <g
              className={styles.ink}
              strokeWidth="3"
              strokeLinecap="round"
              fill="none"
            >
              <path d="M11 12 V14" />
              <path d="M21 12 V14" />
              <path d={MOUTH[option.value] ?? MOUTH.neutral} />
            </g>
          </svg>
        </button>
      ))}
    </div>
  );
}
