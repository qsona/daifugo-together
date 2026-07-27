import type {
  RuleCatalogKind,
  RuleCatalogResponse,
  RuleCatalogStatus,
} from '@daifugo/core';
import { PREFECTURES } from '@daifugo/core';
import { useCallback, useEffect, useState } from 'react';

import { AppBar } from '../components/AppBar';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { RuleCard } from '../components/RuleCard';
import type { RuleCatalogApi } from '../rules/client';
import { ruleOriginLabel } from '../rules/origin';

import styles from './RuleDexScreen.module.css';
import screen from './screen.module.css';

const PAGE_SIZE = 30;

export function RuleDexScreen({
  api,
  onBack,
}: {
  api: RuleCatalogApi;
  onBack: () => void;
}) {
  const [prefecture, setPrefecture] = useState('');
  const [status, setStatus] = useState<'' | RuleCatalogStatus>('');
  const [kind, setKind] = useState<'' | RuleCatalogKind>('');
  const [result, setResult] = useState<RuleCatalogResponse | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    (offset: number, append: boolean) => {
      setLoading(true);
      setError(false);
      void api
        .list({
          ...(prefecture ? { prefecture } : {}),
          ...(status ? { status } : {}),
          ...(kind ? { kind } : {}),
          limit: PAGE_SIZE,
          offset,
        })
        .then((next) => {
          setResult((current) =>
            append && current
              ? { ...next, items: [...current.items, ...next.items] }
              : next,
          );
        })
        .catch(() => setError(true))
        .finally(() => setLoading(false));
    },
    [api, kind, prefecture, status],
  );

  useEffect(() => {
    load(0, false);
  }, [load]);

  const shown = result?.items.length ?? 0;
  const remaining = Math.max(0, (result?.page.total ?? 0) - shown);
  return (
    <div className={screen.screen}>
      <AppBar title="ルール図鑑" onBack={onBack} />
      <main className={screen.body}>
        <div className={styles.filters}>
          <label className={styles.filter}>
            都道府県
            <select
              value={prefecture}
              onChange={(event) => setPrefecture(event.target.value)}
            >
              <option value="">すべて</option>
              <option value="none">県の記載なし</option>
              {PREFECTURES.map(({ code, name }) => (
                <option key={code} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.filter}>
            状態
            <select
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as '' | RuleCatalogStatus)
              }
            >
              <option value="">すべて</option>
              <option value="active">有効</option>
              <option value="removed">排除済み</option>
            </select>
          </label>
          <label className={styles.filter}>
            区分
            <select
              value={kind}
              onChange={(event) =>
                setKind(event.target.value as '' | RuleCatalogKind)
              }
            >
              <option value="">すべて</option>
              <option value="local">ローカル</option>
              <option value="original">オリジナル</option>
            </select>
          </label>
          <label className={styles.filter}>
            並び順
            <select value="recent" disabled>
              <option value="recent">新着順</option>
            </select>
          </label>
        </div>
        {result && (
          <>
            <p className={styles.summary}>
              実装済みルール {result.summary.implemented} 件（有効{' '}
              {result.summary.active}・排除済み {result.summary.removed}） /
              都道府県カバー {result.summary.prefectureCoverage}
            </p>
            <p className={styles.note}>
              「報告: 〜県」は、提案した人がその土地で遊んでいたという記録です。
            </p>
          </>
        )}
        {error && (
          <p role="alert" className={styles.error}>
            ルール図鑑を読み込めませんでした。
          </p>
        )}
        {!error && result?.items.length === 0 && (
          <EmptyState
            title="まだ実装されたルールはありません"
            description="提案が採用されるとここに載ります。"
          />
        )}
        <div className={styles.items}>
          {result?.items.map((rule) => {
            const origin = ruleOriginLabel(rule.kind, rule.prefecture);
            return (
              <RuleCard
                key={rule.id}
                rule={{
                  name: rule.name,
                  priority: rule.priority,
                  category: rule.kind,
                  ...(rule.prefecture ? { prefecture: rule.prefecture } : {}),
                  originLabel: origin.badge,
                  description:
                    rule.status === 'removed'
                      ? '低評価が集まったため排除'
                      : (origin.sentence ?? rule.description),
                  popularity: rule.popularity,
                  status: rule.status,
                }}
              />
            );
          })}
        </div>
        {remaining > 0 && (
          <Button block disabled={loading} onClick={() => load(shown, true)}>
            {loading ? '読み込み中…' : `…ほか ${String(remaining)} 件`}
          </Button>
        )}
      </main>
    </div>
  );
}
