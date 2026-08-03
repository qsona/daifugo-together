import type {
  RuleCatalogItem,
  RuleCatalogKind,
  RuleCatalogResponse,
  RuleCatalogStatus,
} from '@daifugo/core';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { AppBar } from '../components/AppBar';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { RuleCard } from '../components/RuleCard';
import { FEATURES, type FeatureFlags } from '../features';
import { buildXShareUrl } from '../links';
import type { RuleCatalogApi } from '../rules/client';

import styles from './RuleDexScreen.module.css';
import screen from './screen.module.css';

const PAGE_SIZE = 30;

export function RuleDexScreen({
  api,
  onBack,
  features = FEATURES,
  notification,
  initialRuleId,
}: {
  api: Pick<RuleCatalogApi, 'list'> & Partial<Pick<RuleCatalogApi, 'get'>>;
  onBack: () => void;
  features?: FeatureFlags;
  notification?: ReactNode;
  initialRuleId?: string | null;
}) {
  const [status, setStatus] = useState<'' | RuleCatalogStatus>('');
  const [kind, setKind] = useState<'' | RuleCatalogKind>('');
  const [sort, setSort] = useState<'recent' | 'priority' | 'popularity'>(
    features.popularity ? 'popularity' : 'recent',
  );
  const [result, setResult] = useState<RuleCatalogResponse | null>(null);
  const [error, setError] = useState<'initial' | 'append' | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(
    initialRuleId ?? null,
  );
  const [focusedRule, setFocusedRule] = useState<RuleCatalogItem | null>(null);
  const requestSequence = useRef(0);

  const load = useCallback(
    (offset: number, append: boolean) => {
      const requestId = ++requestSequence.current;
      setLoading(true);
      setError(null);
      void api
        .list({
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
    [api, kind, sort, status],
  );

  useEffect(() => {
    setResult(null);
    setExpandedId(initialRuleId ?? null);
    load(0, false);
  }, [initialRuleId, load]);
  useEffect(() => {
    if (!initialRuleId || !api.get) {
      setFocusedRule(null);
      return;
    }
    let active = true;
    setFocusedRule(null);
    void api.get(initialRuleId).then(
      (rule) => {
        if (active) setFocusedRule(rule);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [api, initialRuleId]);
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
      <AppBar title="ルール図鑑" onBack={onBack} notification={notification} />
      <main className={screen.body}>
        <div className={styles.filters}>
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
              {features.elimination && <option value="removed">引退</option>}
            </select>
          </label>
          <label className={styles.filter}>
            種類
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
          <p className={styles.summary}>
            {`登場したルール ${String(result.summary.implemented)}件(有効 ${String(result.summary.active)}・引退 ${String(result.summary.removed)})`}
          </p>
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
            title="まだ登場したルールはありません"
            description="提案が採用されるとここに載ります。"
          />
        )}
        <div className={styles.items}>
          {(result
            ? focusedRule &&
              !result.items.some((rule) => rule.id === focusedRule.id)
              ? [focusedRule, ...result.items]
              : result.items
            : focusedRule
              ? [focusedRule]
              : []
          )
            .filter((rule) => features.elimination || rule.status === 'active')
            .map((rule) => {
              const listDescription =
                rule.status === 'removed'
                  ? '低評価が集まって引退'
                  : rule.description;
              return (
                <div key={rule.id} className={styles.ruleEntry}>
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
                        <dt>種類</dt>
                        <dd>
                          {rule.kind === 'local' ? 'ローカル' : 'オリジナル'}
                        </dd>
                        <dt>状態</dt>
                        <dd>{rule.status === 'removed' ? '引退' : '有効'}</dd>
                        <dt>登場日</dt>
                        <dd>{formatDate(rule.implementedAt)}</dd>
                        {rule.removedAt && (
                          <>
                            <dt>引退日</dt>
                            <dd>{formatDate(rule.removedAt)}</dd>
                          </>
                        )}
                      </dl>
                    </section>
                  )}
                  <a
                    className={styles.shareLink}
                    href={buildXShareUrl(ruleShareText(rule), '/rules')}
                    target="_blank"
                    rel="noreferrer"
                  >
                    𝕏 このルールをシェア
                  </a>
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
            {loading ? '読み込み中…' : `…ほか ${String(remaining)}件`}
          </Button>
        )}
      </main>
    </div>
  );
}

function ruleShareText(rule: {
  name: string;
  description: string | null;
  prefecture: string | null;
}): string {
  const place = rule.prefecture ? `(${rule.prefecture}で遊ばれていた報告)` : '';
  const description = Array.from(
    rule.description?.trim().replaceAll(/\s+/gu, ' ') ?? '',
  )
    .slice(0, 40)
    .join('');
  return `ルール図鑑「${rule.name}」${place}${description ? `\n${description}` : ''}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Tokyo',
  }).format(new Date(value));
}
