import type { ReactNode } from 'react';

import styles from './Callout.module.css';

type CalloutProps = {
  children: ReactNode;
  /** 右端に置く小さな導線(件数一覧へ・コピーなど)。 */
  action?: ReactNode;
};

/** 画面に添える一文の注記。強調色は使わず、地の説明として淡く出す。 */
export function Callout({ children, action }: CalloutProps) {
  return (
    <div className={styles.callout}>
      <p className={styles.text}>{children}</p>
      {action}
    </div>
  );
}
