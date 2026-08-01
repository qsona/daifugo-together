import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ReactNode,
} from 'react';

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

type LinkButtonProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  'className'
> & {
  variant?: 'primary' | 'secondary';
  size?: 'medium' | 'small';
  block?: boolean;
  children: ReactNode;
};

function buttonClassName(
  variant: 'primary' | 'secondary',
  size: 'medium' | 'small',
  block: boolean,
): string {
  return cx(
    styles.button,
    variant === 'primary' && styles.primary,
    size === 'small' && styles.small,
    block && styles.block,
  );
}

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
      className={buttonClassName(variant, size, block)}
      {...rest}
    >
      {children}
    </button>
  );
}

/** 外部遷移にも Button と同じ見た目と優先度を与える。 */
export function LinkButton({
  variant = 'secondary',
  size = 'medium',
  block = false,
  children,
  ...rest
}: LinkButtonProps) {
  return (
    <a className={buttonClassName(variant, size, block)} {...rest}>
      {children}
    </a>
  );
}
