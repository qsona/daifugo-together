import type { ReactNode } from 'react';

import { cx } from '../lib/cx';

import styles from './Tag.module.css';

export type TagVariant =
  'local' | 'original' | 'active' | 'removed' | 'human' | 'ai';

type TagProps = {
  variant: TagVariant;
  children: ReactNode;
};

export function Tag({ variant, children }: TagProps) {
  return <span className={cx(styles.tag, styles[variant])}>{children}</span>;
}
