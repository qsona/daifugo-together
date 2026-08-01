import type { RuleRef } from '@daifugo/core';

import { AppBar } from '../components/AppBar';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { RuleNameList } from '../components/RuleCard';

import styles from './ActiveRulesScreen.module.css';
import screen from './screen.module.css';

export function ActiveRulesScreen({
  rules,
  onBack,
  onOpenDex,
  showDexLink = true,
}: {
  rules: readonly RuleRef[];
  onBack: () => void;
  onOpenDex: () => void;
  showDexLink?: boolean;
}) {
  return (
    <div className={screen.screen}>
      <AppBar
        title="この対局のルール"
        onBack={onBack}
        action={{ label: `${String(rules.length)}件` }}
      />
      <main className={screen.body}>
        <p className={styles.caption}>
          {String(rules.length)}件・すべての卓に適用
        </p>
        {rules.length === 0 ? (
          <EmptyState
            title="追加ルールはありません"
            description="この対局は基本ルールだけであそびます。"
          />
        ) : (
          <RuleNameList rules={rules} />
        )}
        {showDexLink && (
          <div className={screen.inlineAction}>
            <Button size="small" onClick={onOpenDex}>
              図鑑でくわしく
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
