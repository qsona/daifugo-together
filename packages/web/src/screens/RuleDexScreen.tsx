import type {
  RuleCatalogKind,
  RuleCatalogResponse,
  RuleCatalogStatus,
} from '@daifugo/core';
import { PREFECTURES } from '@daifugo/core';
import { useCallback, useEffect, useRef, useState } from 'react';

import { AppBar } from '../components/AppBar';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { RuleCard } from '../components/RuleCard';
import { FEATURES, type FeatureFlags } from '../features';
import type { RuleCatalogApi } from '../rules/client';
import { ruleOriginLabel } from '../rules/origin';

import styles from './RuleDexScreen.module.css';
import screen from './screen.module.css';

const PAGE_SIZE = 30;

export function RuleDexScreen({
  api,
  onBack,
  features = FEATURES,
}: {
  api: RuleCatalogApi;
  onBack: () => void;
  features?: FeatureFlags;
}) {
  const [prefecture, setPrefecture] = useState('');
  const [status, setStatus] = useState<'' | RuleCatalogStatus>('');
  const [kind, setKind] = useState<'' | RuleCatalogKind>('');
  const [sort, setSort] = useState<'recent' | 'priority' | 'popularity'>(
    features.popularity ? 'popularity' : 'recent',
  );
  const [result, setResult] = useState<RuleCatalogResponse | null>(null);
  const [error, setError] = useState<'initial' | 'append' | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const load = useCallback(
    (offset: number, append: boolean) => {
      const requestId = ++requestSequence.current;
      setLoading(true);
      setError(null);
      void api
        .list({
          ...(prefecture ? { prefecture } : {}),
          ...(status ? { status } : {}),
          ...(kind ? { kind } : {}),
          sort,
          order: 'desc',
          limit: PAGE_SIZE,
          offset,
        })
        .then((next) => {
          if (requestId !== requestSequence.current) return;
          setResult((current) =>
            append && current
              ? { ...next, items: [...current.items, ...next.items] }
              : next,
          );
        })
        .catch(() => {
          if (requestId === requestSequence.current) {
            setError(append ? 'append' : 'initial');
          }
        })
        .finally(() => {
          if (requestId === requestSequence.current) setLoading(false);
        });
    },
    [api, kind, prefecture, sort, status],
  );

  useEffect(() => {
    setResult(null);
    setExpandedId(null);
    load(0, false);
  }, [load]);
  useEffect(
    () => () => {
      requestSequence.current += 1;
    },
    [],
  );

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
              {features.elimination && (
                <option value="removed">排除済み</option>
              )}
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
            <select
              value={sort}
              onChange={(event) =>
                setSort(
                  event.target.value as 'recent' | 'priority' | 'popularity',
                )
              }
            >
              <option value="recent">新着順</option>
              {features.priority && <option value="priority">優先度順</option>}
              {features.popularity && (
                <option value="popularity">人気度順</option>
              )}
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
        {error === 'initial' && (
          <p role="alert" className={styles.error}>
            ルール図鑑を読み込めませんでした。
            <Button size="small" onClick={() => load(0, false)}>
              もう一度ためす
            </Button>
          </p>
        )}
        {error !== 'initial' && result?.items.length === 0 && (
          <EmptyState
            title="まだ実装されたルールはありません"
            description="提案が採用されるとここに載ります。"
          />
        )}
        <div className={styles.items}>
          {result?.items
            .filter((rule) => features.elimination || rule.status === 'active')
            .map((rule) => {
              const origin = ruleOriginLabel(rule.kind, rule.prefecture);
              const listDescription =
                rule.status === 'removed'
                  ? '低評価が集まったため排除'
                  : (origin.sentence ?? rule.description);
              return (
                <div key={rule.id}>
                  <button
                    type="button"
                    className={styles.ruleButton}
                    aria-expanded={expandedId === rule.id}
                    onClick={() =>
                      setExpandedId((current) =>
                        current === rule.id ? null : rule.id,
                      )
                    }
                  >
                    <RuleCard
                      rule={{
                        name: rule.name,
                        priority: features.priority ? rule.priority : null,
                        category: rule.kind,
                        ...(rule.prefecture
                          ? { prefecture: rule.prefecture }
                          : {}),
                        originLabel: origin.badge,
                        ...(listDescription
                          ? { description: listDescription }
                          : {}),
                        popularity: features.popularity
                          ? rule.popularity
                          : null,
                        status: rule.status,
                      }}
                    />
                  </button>
                  {expandedId === rule.id && (
                    <section
                      className={styles.detail}
                      aria-label={`${rule.name}の詳細`}
                    >
                      <p>{rule.description ?? '説明はありません。'}</p>
                      <dl>
                        <dt>区分</dt>
                        <dd>{origin.badge}</dd>
                        <dt>状態</dt>
                        <dd>
                          {rule.status === 'removed' ? '排除済み' : '有効'}
                        </dd>
                        <dt>実装日</dt>
                        <dd>{formatDate(rule.implementedAt)}</dd>
                        {rule.removedAt && (
                          <>
                            <dt>排除日</dt>
                            <dd>{formatDate(rule.removedAt)}</dd>
                          </>
                        )}
                      </dl>
                    </section>
                  )}
                </div>
              );
            })}
        </div>
        {error === 'append' && (
          <p role="alert" className={styles.error}>
            続きを読み込めませんでした。表示済みのルールはそのままです。
          </p>
        )}
        {remaining > 0 && (
          <Button block disabled={loading} onClick={() => load(shown, true)}>
            {loading ? '読み込み中…' : `…ほか ${String(remaining)} 件`}
          </Button>
        )}
      </main>
    </div>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Tokyo',
  }).format(new Date(value));
}
