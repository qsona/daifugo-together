import { Button } from './Button';
import { Tag } from './Tag';

import styles from './AccountRow.module.css';

export type AccountState =
  'anonymous' | 'registered' | 'pending' | 'connecting';

export function isDefaultDisplayName(displayName: string | null): boolean {
  return displayName !== null && /^ゲスト[0-9A-Z]{6}$/u.test(displayName);
}

/** 登録済みは通常状態なのでバッジを出さない。 */
const STATE_LABELS: Record<AccountState, string | null> = {
  anonymous: 'ゲスト',
  registered: null,
  pending: 'ログイン中',
  connecting: '接続中',
};

/**
 * メニュー最上部のアカウント行。
 * 未ログインのときは「ゲスト」バッジの代わりに「ログイン」を常設する
 * (2026-08-09 開発者判断)。バッジだけだと、前にあそんだことがある人が
 * 「ここからログインできる」と気づけず、アプリにログイン導線が無いように見える。
 * 行全体が記録画面を開くボタンなので、ログインは入れ子にできない。
 * 外側を div にして、記録を開くボタンとログインボタンを並べる。
 */
export function AccountRow({
  displayName,
  state,
  isDefaultName,
  onOpen,
  onLogin,
}: {
  displayName: string | null;
  state: AccountState;
  isDefaultName: boolean;
  onOpen: () => void;
  onLogin?: () => void;
}) {
  const disabled = state === 'pending' || state === 'connecting';
  const shownName = state === 'connecting' ? '—' : (displayName ?? '—');
  const showLogin = state === 'anonymous' && onLogin !== undefined;
  const stateLabel = showLogin ? null : STATE_LABELS[state];
  return (
    <div className={styles.row}>
      <button
        type="button"
        className={styles.open}
        disabled={disabled}
        onClick={onOpen}
        aria-label={[shownName, stateLabel, '記録を開く']
          .filter((part) => part !== null)
          .join('、')}
      >
        <span
          className={isDefaultName ? styles.defaultName : styles.name}
          data-default-name={isDefaultName ? 'true' : undefined}
        >
          {shownName}
        </span>
        {stateLabel !== null && (
          <Tag variant={state === 'registered' ? 'accountActive' : 'account'}>
            {stateLabel}
          </Tag>
        )}
        <span className={styles.chevron} aria-hidden="true">
          ›
        </span>
      </button>
      {showLogin && (
        <Button size="small" onClick={onLogin}>
          ログイン
        </Button>
      )}
    </div>
  );
}
