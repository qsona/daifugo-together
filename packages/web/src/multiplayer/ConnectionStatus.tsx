import type { ReactNode } from 'react';

import type { MultiplayerState } from './client';
import styles from './ConnectionStatus.module.css';

export function ConnectionStatus({
  state,
  children,
}: {
  state: MultiplayerState;
  children: ReactNode;
}) {
  const message =
    state.connection === 'superseded'
      ? '別の画面で接続されました'
      : state.room && state.connection === 'connecting'
        ? '接続が切れました。再接続しています…'
        : null;
  return (
    <>
      {children}
      {message && (
        <div className={styles.overlay}>
          <p className={styles.message} role="status">
            {message}
          </p>
        </div>
      )}
    </>
  );
}
