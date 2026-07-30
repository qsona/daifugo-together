import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';

import { cx } from '../lib/cx';

import styles from './TurnCountdown.module.css';

export function TurnCountdown({ deadlineAt }: { deadlineAt: number }) {
  const [remainingMs, setRemainingMs] = useState(() =>
    Math.max(0, deadlineAt - Date.now()),
  );
  useEffect(() => {
    const update = () => {
      setRemainingMs(Math.max(0, deadlineAt - Date.now()));
    };
    update();
    const timer = window.setInterval(update, 100);
    return () => window.clearInterval(timer);
  }, [deadlineAt]);

  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const fraction = Math.min(1, remainingMs / 60_000);
  return (
    <div
      className={cx(
        styles.turnCountdown,
        remainingMs <= 10_000 && styles.turnCountdownUrgent,
      )}
      role="timer"
      aria-label={`手番 残り${String(remainingSeconds)}秒`}
    >
      <div className={styles.turnCountdownTrack} aria-hidden="true">
        <div
          className={styles.turnCountdownFill}
          style={{ '--turn-remaining': fraction } as CSSProperties}
        />
      </div>
    </div>
  );
}
