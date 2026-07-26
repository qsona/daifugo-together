import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cx } from '../lib/cx';

import styles from './Button.module.css';

type ButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'className'
> & {
  /** primary は 1 画面 1 個まで(design-system.html §5-1)。 */
  variant?: 'primary' | 'secondary';
  size?: 'medium' | 'small';
  /** 縦積みメニュー用に横幅いっぱいへ広げる。 */
  block?: boolean;
  children: ReactNode;
};

export function Button({
  variant = 'secondary',
  size = 'medium',
  block = false,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        styles.button,
        variant === 'primary' && styles.primary,
        size === 'small' && styles.small,
        block && styles.block,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
