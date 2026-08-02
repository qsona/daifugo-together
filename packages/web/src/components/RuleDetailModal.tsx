import type { RuleCatalogItem } from '@daifugo/core';
import { useEffect, useRef, useState } from 'react';

import type { RuleCatalogApi } from '../rules/client';

import { Button } from './Button';
import { Dialog } from './Dialog';
import styles from './RuleDetailModal.module.css';

/**
 * 発動したルール 1 件の詳細。名前は即座に出し、
 * 説明文だけ図鑑 API の応答で後追いに差し込む。
 */
export function RuleDetailModal({
  api,
  ruleId,
  name,
  effectLabel,
  onClose,
}: {
  api: RuleCatalogApi;
  ruleId: string;
  name: string;
  effectLabel?: string;
  onClose: () => void;
}) {
  const [rule, setRule] = useState<RuleCatalogItem | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const requestSequence = useRef(0);

  useEffect(() => {
    const requestId = ++requestSequence.current;
    setRule(null);
    setFailed(false);
    void api.get(ruleId).then(
      (loaded) => {
        if (requestId === requestSequence.current) setRule(loaded);
      },
      () => {
        if (requestId === requestSequence.current) setFailed(true);
      },
    );
    return () => {
      requestSequence.current += 1;
    };
  }, [api, attempt, ruleId]);

  return (
    <Dialog
      title={name}
      align="start"
      onClose={onClose}
      closeLabel="ルール一覧に戻る"
    >
      {effectLabel && <p className={styles.effect}>{effectLabel}</p>}
      {rule?.description && (
        <p className={styles.description}>{rule.description}</p>
      )}
      {failed && (
        <div className={styles.failed} role="alert">
          <span>説明を読み込めませんでした</span>
          <Button
            size="small"
            onClick={() => {
              setAttempt((count) => count + 1);
            }}
          >
            もう一度ためす
          </Button>
        </div>
      )}
    </Dialog>
  );
}
