import { cx } from '../lib/cx';

import styles from './Log.module.css';

export type LogEntry = {
  id: string;
  text: string;
  /** ルール発動の行は強調する。 */
  kind: 'play' | 'ruleFired';
};

export function Log({ entries }: { entries: readonly LogEntry[] }) {
  return (
    <div className={styles.log}>
      <ul className={styles.list} aria-label="実況ログ">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className={cx(
              styles.entry,
              entry.kind === 'ruleFired' && styles.ruleFired,
            )}
          >
            {entry.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
