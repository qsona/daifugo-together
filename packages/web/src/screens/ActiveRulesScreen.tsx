import type { RuleRef } from '@daifugo/core';

import { AppBar } from '../components/AppBar';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { RuleNameList } from '../components/RuleCard';

import screen from './screen.module.css';

export function ActiveRulesScreen({
  rules,
  onBack,
  onOpenDex,
}: {
  rules: readonly RuleRef[];
  onBack: () => void;
  onOpenDex: () => void;
}) {
  return (
    <div className={screen.screen}>
      <AppBar
        title="この対局のルール"
        onBack={onBack}
        action={{ label: `${String(rules.length)}件` }}
      />
      <main className={screen.body}>
        {rules.length === 0 ? (
          <EmptyState
            title="追加ルールはありません"
            description="この対局は基本ルールだけで遊びます。"
          />
        ) : (
          <RuleNameList names={rules.map((rule) => rule.name)} />
        )}
        <div className={screen.inlineAction}>
          <Button size="small" onClick={onOpenDex}>
            図鑑でくわしく
          </Button>
        </div>
      </main>
    </div>
  );
}
