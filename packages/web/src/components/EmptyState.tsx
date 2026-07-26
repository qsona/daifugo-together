import type { ReactNode } from 'react';

import styles from './EmptyState.module.css';

type EmptyStateProps = {
  title: string;
  description: string;
  /** 次の行動。見出し+一文+次の行動、の 3 点構成を守る。 */
  action?: ReactNode;
};

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      <span className={styles.art} aria-hidden="true">
        <i />
        <i />
      </span>
      <h2 className={styles.title}>{title}</h2>
      <p className={styles.body}>{description}</p>
      {action}
    </div>
  );
}
