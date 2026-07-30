import type { RuleRef } from '@daifugo/core';

import { Dialog } from './Dialog';
import { EmptyState } from './EmptyState';
import { RuleNameList } from './RuleCard';

/**
 * 部屋の中から開く有効ルール一覧。
 * 対局中に盤面を離れないよう、画面遷移ではなくモーダルで重ねる。
 */
export function ActiveRulesModal({
  rules,
  onSelectRule,
  onClose,
}: {
  rules: readonly RuleRef[];
  onSelectRule: (ruleId: string) => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      title="この対局のルール"
      size="wide"
      align="start"
      onClose={onClose}
    >
      <p>{String(rules.length)} 件・すべての卓に適用（変更不可）</p>
      {rules.length === 0 ? (
        <EmptyState
          title="追加ルールはありません"
          description="この対局は基本ルールだけで遊びます。"
        />
      ) : (
        <RuleNameList rules={rules} onSelect={onSelectRule} />
      )}
    </Dialog>
  );
}
