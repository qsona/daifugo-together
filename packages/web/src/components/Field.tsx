import { useId } from 'react';
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

import { cx } from '../lib/cx';

import styles from './Field.module.css';

type FieldShellProps = {
  label: string;
  /** 任意項目はラベル末尾に「(任意)」を付ける。 */
  optional?: boolean;
  /** 補足説明。エラーがあるときはエラー文言が優先して読み上げられる。 */
  caption?: string;
  error?: string;
  children: (ids: { controlId: string; describedBy?: string }) => ReactNode;
};

function FieldShell({
  label,
  optional = false,
  caption,
  error,
  children,
}: FieldShellProps) {
  const controlId = useId();
  const captionId = `${controlId}-caption`;
  const errorId = `${controlId}-error`;
  const describedBy =
    [error ? errorId : null, caption ? captionId : null]
      .filter((id) => id !== null)
      .join(' ') || undefined;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={controlId}>
        {label}
        {optional && <span className={styles.optional}> (任意)</span>}
      </label>
      {children({ controlId, ...(describedBy ? { describedBy } : {}) })}
      {error && (
        <p id={errorId} className={cx(styles.caption, styles.error)}>
          {error}
        </p>
      )}
      {caption && (
        <p id={captionId} className={styles.caption}>
          {caption}
        </p>
      )}
    </div>
  );
}

type ControlProps = Omit<FieldShellProps, 'children'>;

export function InputField({
  label,
  optional,
  caption,
  error,
  ...rest
}: ControlProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'className'>) {
  return (
    <FieldShell
      label={label}
      {...(optional === undefined ? {} : { optional })}
      {...(caption === undefined ? {} : { caption })}
      {...(error === undefined ? {} : { error })}
    >
      {({ controlId, describedBy }) => (
        <input
          id={controlId}
          className={cx(styles.control, error && styles.invalid)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...rest}
        />
      )}
    </FieldShell>
  );
}

export function TextareaField({
  label,
  optional,
  caption,
  error,
  ...rest
}: ControlProps &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'>) {
  return (
    <FieldShell
      label={label}
      {...(optional === undefined ? {} : { optional })}
      {...(caption === undefined ? {} : { caption })}
      {...(error === undefined ? {} : { error })}
    >
      {({ controlId, describedBy }) => (
        <textarea
          id={controlId}
          className={cx(
            styles.control,
            styles.textarea,
            error && styles.invalid,
          )}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...rest}
        />
      )}
    </FieldShell>
  );
}

export function SelectField({
  label,
  optional,
  caption,
  error,
  children,
  ...rest
}: ControlProps &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> & {
    children: ReactNode;
  }) {
  return (
    <FieldShell
      label={label}
      {...(optional === undefined ? {} : { optional })}
      {...(caption === undefined ? {} : { caption })}
      {...(error === undefined ? {} : { error })}
    >
      {({ controlId, describedBy }) => (
        <select
          id={controlId}
          className={cx(styles.control, error && styles.invalid)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...rest}
        >
          {children}
        </select>
      )}
    </FieldShell>
  );
}
