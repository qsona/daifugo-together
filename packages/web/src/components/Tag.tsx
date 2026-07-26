import type { ReactNode } from 'react';

import { cx } from '../lib/cx';

import styles from './Tag.module.css';

export type TagVariant =
  'pref' | 'local' | 'original' | 'active' | 'removed' | 'human' | 'ai';

type TagProps = {
  variant: TagVariant;
  children: ReactNode;
};

export function Tag({ variant, children }: TagProps) {
  return <span className={cx(styles.tag, styles[variant])}>{children}</span>;
}

/**
 * 都道府県タグ。文言は「報告: ◯◯県」固定(企画書 §4.1)。
 * 「◯◯県のルール」という断定形はどの画面でも使わないため、
 * 非断定表現をコンポーネント仕様に焼き込んでいる。
 */
export function PrefectureTag({ prefecture }: { prefecture: string }) {
  return <Tag variant="pref">報告: {prefecture}</Tag>;
}
