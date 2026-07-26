import { cx } from '../lib/cx';

import styles from './VoteButton.module.css';

type VoteButtonProps = {
  direction: 'up' | 'down';
  /** 選択済みかどうか。色だけに頼らず文言も「〜済み」に変える。 */
  selected: boolean;
  onClick: () => void;
};

export function VoteButton({ direction, selected, onClick }: VoteButtonProps) {
  const base = direction === 'up' ? '高評価' : '低評価';

  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cx(styles.vote, styles[direction], selected && styles.on)}
      onClick={onClick}
    >
      <svg
        className={cx(styles.icon, direction === 'down' && styles.iconDown)}
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M2 7h3v7H2z" />
        <path d="M5 13V7l3-5c1 0 2 .8 2 2L9.4 7H13c.8 0 1.4.8 1.2 1.6l-1 4C13 13.4 12.4 14 11.6 14H5z" />
      </svg>
      {selected ? `${base}済み` : base}
    </button>
  );
}
