import type { NotificationView } from '@daifugo/core';
import { useEffect, useState } from 'react';

import { AppBar } from '../components/AppBar';
import { Button, LinkButton } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { buildXShareUrl } from '../links';
import type { NotificationClient } from '../notification/client';

import styles from './NotificationsScreen.module.css';
import screen from './screen.module.css';

function relativeTime(timestamp: number): string {
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 60_000) return 'たった今';
  if (elapsed < 60 * 60_000)
    return `${String(Math.floor(elapsed / 60_000))}分前`;
  if (elapsed < 24 * 60 * 60_000)
    return `${String(Math.floor(elapsed / (60 * 60_000)))}時間前`;
  return `${String(Math.floor(elapsed / (24 * 60 * 60_000)))}日前`;
}

export function NotificationsScreen({
  api,
  onBack,
  onOpen,
  onSettings,
  onUnreadCountChange,
}: {
  api: Pick<NotificationClient, 'list' | 'opened' | 'readAll'>;
  onBack: () => void;
  onOpen: (item: NotificationView) => void;
  onSettings: () => void;
  onUnreadCountChange: (count: number) => void;
}) {
  const [items, setItems] = useState<NotificationView[] | null>(null);
  const [error, setError] = useState(false);
  const [actionError, setActionError] = useState(false);

  useEffect(() => {
    let active = true;
    void api.list().then(
      (result) => {
        if (!active) return;
        setItems(result.items);
        onUnreadCountChange(result.unreadCount);
      },
      () => {
        if (active) setError(true);
      },
    );
    return () => {
      active = false;
    };
  }, [api, onUnreadCountChange]);

  const readAll = async () => {
    try {
      await api.readAll();
      setItems(
        (current) =>
          current?.map((item) => ({
            ...item,
            readAt: item.readAt ?? Date.now(),
          })) ?? current,
      );
      setActionError(false);
      onUnreadCountChange(0);
    } catch {
      setActionError(true);
    }
  };

  return (
    <div className={screen.screen}>
      <AppBar
        title="おしらせ"
        onBack={onBack}
        action={{ label: '通知設定', onClick: onSettings }}
      />
      <main className={screen.body}>
        {items?.some((item) => item.readAt === null) && (
          <div className={screen.inlineAction}>
            <Button size="small" onClick={() => void readAll()}>
              すべて既読
            </Button>
          </div>
        )}
        {error && <p role="alert">おしらせを読み込めませんでした。</p>}
        {actionError && <p role="alert">既読にできませんでした。</p>}
        {!error && items === null && <p role="status">読み込み中…</p>}
        {items?.length === 0 && (
          <EmptyState
            title="おしらせはまだないよ"
            description="提案や新しいルールの動きが、ここに届きます。"
          />
        )}
        {items && items.length > 0 && (
          <ol className={styles.list}>
            {items.map((item) => (
              <li key={item.id} className={styles.itemCard}>
                <button
                  type="button"
                  className={styles.item}
                  data-unread={item.readAt === null ? 'true' : 'false'}
                  onClick={() => {
                    void api
                      .opened(item.id, 'center')
                      .finally(() => onOpen(item));
                  }}
                >
                  <span className={styles.icon} aria-hidden="true">
                    {item.type === 'rule_debut' ? '♠' : '★'}
                  </span>
                  <span className={styles.copy}>
                    <strong>{item.title}</strong>
                    <span>{item.body}</span>
                    <time dateTime={new Date(item.createdAt).toISOString()}>
                      {relativeTime(item.createdAt)}
                    </time>
                  </span>
                  {item.readAt === null && (
                    <span className={styles.unread} aria-label="未読" />
                  )}
                </button>
                {item.type === 'proposal_released' &&
                  typeof item.payload.proposalName === 'string' &&
                  item.payload.proposalName.trim() && (
                    <LinkButton
                      size="small"
                      href={buildXShareUrl(
                        `提案したルール「${item.payload.proposalName.trim()}」が、みんなでつくろう大富豪に実装されました`,
                        '/rules',
                      )}
                      target="_blank"
                      rel="noreferrer"
                    >
                      𝕏 じまんする
                    </LinkButton>
                  )}
              </li>
            ))}
          </ol>
        )}
      </main>
    </div>
  );
}
