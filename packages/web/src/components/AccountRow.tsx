import { Tag } from './Tag';

import styles from './AccountRow.module.css';

export type AccountState =
  'anonymous' | 'registered' | 'pending' | 'connecting';

export function isDefaultDisplayName(displayName: string | null): boolean {
  return displayName !== null && /^ゲスト[0-9A-Z]{6}$/u.test(displayName);
}

const STATE_LABELS: Record<AccountState, string> = {
  anonymous: 'ゲスト',
  registered: 'どの端末でも',
  pending: 'つなぎ中',
  connecting: '接続中',
};

export function AccountRow({
  displayName,
  state,
  isDefaultName,
  onOpen,
}: {
  displayName: string | null;
  state: AccountState;
  isDefaultName: boolean;
  onOpen: () => void;
}) {
  const disabled = state === 'pending' || state === 'connecting';
  const shownName = state === 'connecting' ? '—' : (displayName ?? '—');
  return (
    <button
      type="button"
      className={styles.row}
      disabled={disabled}
      onClick={onOpen}
      aria-label={`${shownName}、${STATE_LABELS[state]}、記録を開く`}
    >
      <span
        className={isDefaultName ? styles.defaultName : styles.name}
        data-default-name={isDefaultName ? 'true' : undefined}
      >
        {shownName}
      </span>
      <Tag variant={state === 'registered' ? 'accountActive' : 'account'}>
        {STATE_LABELS[state]}
      </Tag>
      <span className={styles.chevron} aria-hidden="true">
        ›
      </span>
    </button>
  );
}
