import type {
  MyProposalsResponse,
  ProposalListItem,
  ProposalStatus,
} from '@daifugo/core';
import { useEffect, useState } from 'react';

import { AppBar } from '../components/AppBar';
import {
  ProposalStepper,
  type ProposalStep,
} from '../components/ProposalStepper';
import type { ProposalApi } from '../proposal/client';

import styles from './MyProposalsScreen.module.css';
import screen from './screen.module.css';

const STATUS_LABELS: Record<ProposalStatus, string> = {
  screening: '確認中',
  implementing: '開発中',
  released: 'あそべる',
  rejected: '見送り',
  failed: '開発できず',
};

const REASON_LABELS: Record<string, string> = {
  infeasible_technical: '現在のしくみでは実装できませんでした。',
  breaks_game: 'ゲームの成立を損なうため実装できませんでした。',
  inappropriate: '安全に扱えない内容が含まれていました。',
  duplicate_rule: '似たルールが既にあります。',
  out_of_scope: 'ルールとして解釈できませんでした。',
  implementation_failed:
    'ルールの実装を完了できませんでした。内容を見直して再提案できます。',
};

function kindLabel(item: ProposalListItem): string {
  if (item.kind === 'original') return 'オリジナル';
  return item.prefectureName
    ? `ローカル（報告: ${item.prefectureName}）`
    : 'ローカル（県の記載なし）';
}

function reasonLabel(item: ProposalListItem): string | null {
  if (!item.reason) return null;
  return item.reason.text || REASON_LABELS[item.reason.code] || '確認中です。';
}

function dateLabel(timestamp: number): string {
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(timestamp);
}

function statusSteps(status: ProposalStatus): ProposalStep[] {
  if (status === 'rejected') {
    return [
      { label: STATUS_LABELS.screening, state: 'done' },
      { label: STATUS_LABELS.rejected, state: 'rejected' },
    ];
  }
  if (status === 'failed') {
    return [
      { label: STATUS_LABELS.screening, state: 'done' },
      { label: STATUS_LABELS.implementing, state: 'done' },
      { label: STATUS_LABELS.failed, state: 'rejected' },
    ];
  }
  return [
    {
      label: STATUS_LABELS.screening,
      state: status === 'screening' ? 'now' : 'done',
    },
    {
      label: STATUS_LABELS.implementing,
      state:
        status === 'implementing'
          ? 'now'
          : status === 'screening'
            ? 'pending'
            : 'done',
    },
    {
      label: STATUS_LABELS.released,
      state: status === 'released' ? 'released' : 'pending',
    },
  ];
}

export function MyProposalsScreen({
  api,
  onBack,
  onUnreadCountChange,
}: {
  api: ProposalApi;
  onBack: () => void;
  onUnreadCountChange?: (count: number) => void;
}) {
  const [items, setItems] = useState<ProposalListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seenError, setSeenError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!api.mine || !api.markProposalsSeen) {
        setError('提案一覧を取得できませんでした');
        return;
      }
      let response: MyProposalsResponse;
      try {
        response = await api.mine();
      } catch {
        if (active) setError('提案一覧を取得できませんでした');
        return;
      }
      if (!active) return;
      setItems(response.items);
      onUnreadCountChange?.(response.unreadCount);
      const seenThrough = response.items.reduce(
        (maximum, item) => Math.max(maximum, item.statusChangedAt),
        0,
      );
      try {
        await api.markProposalsSeen(seenThrough);
        if (active) onUnreadCountChange?.(0);
      } catch {
        if (active) {
          setSeenError(
            '未読状態を更新できませんでした。もう一度開いてください。',
          );
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [api, onUnreadCountChange]);

  return (
    <div className={screen.screen}>
      <AppBar title="マイ提案" onBack={onBack} />
      <main className={screen.body}>
        {error && <p role="alert">{error}</p>}
        {seenError && <p role="alert">{seenError}</p>}
        {!error && items === null && <p role="status">読み込み中…</p>}
        {items?.length === 0 && (
          <p className={styles.empty}>まだ提案はありません。</p>
        )}
        {items?.map((item) => {
          const reason = reasonLabel(item);
          return (
            <article className={styles.card} key={item.id}>
              <div className={styles.heading}>
                <h2>{item.name}</h2>
                {item.unread && <span className={styles.unread}>未読</span>}
              </div>
              <p className={styles.kind}>{kindLabel(item)}</p>
              <ProposalStepper steps={statusSteps(item.status)} />
              <p className={styles.body}>{item.body}</p>
              {reason && <p className={styles.reason}>{reason}</p>}
              <p className={styles.date}>
                {item.status === 'released'
                  ? `${dateLabel(item.statusChangedAt)} から ${STATUS_LABELS.released}`
                  : `${dateLabel(item.statusChangedAt)} 更新`}
              </p>
              {item.status === 'released' && item.releasedRuleId && (
                <p className={styles.ruleLink}>
                  ルール図鑑: {item.releasedRuleId}
                </p>
              )}
            </article>
          );
        })}
      </main>
    </div>
  );
}
