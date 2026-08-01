import { BrandHero, HillDivider } from '../components/BrandHero';
import { Button } from '../components/Button';
import {
  AccountRow,
  isDefaultDisplayName,
  type AccountState,
} from '../components/AccountRow';
import { Callout } from '../components/Callout';
import { useEffect, type ReactNode } from 'react';

import { GOOGLE_CONNECT_LABEL, PROPOSE_RULE_LABEL } from '../messages';
import { SUPPORT_URL, X_ACCOUNT_URL } from '../links';

import styles from './MenuScreen.module.css';
import screen from './screen.module.css';

type MenuScreenProps = {
  onPlay: () => void;
  onPropose: () => void;
  onEncyclopedia: () => void;
  onMyProposals: () => void;
  displayName: string | null;
  accountState: AccountState;
  onOpenAccount: () => void;
  showConnectPrompt?: boolean;
  onConnect?: () => void;
  onConnectPromptShown?: () => void;
  unreadProposalCount?: number;
  notification?: ReactNode;
};

/**
 * 画面 1b: メニュー。
 * ロゴ小 / 主要 3 導線 / 補助導線(マイ提案)。「あそびかた」はページ仕様が
 * 未決のため導線ごと非表示(2026-07-29 開発者判断。ページ設計は E8 実装時に再検討)。
 * コンセプトの一文はキービジュアルの
 * コピーが既に言っているので画面には置かない(UI文言ガイド 原則 3)。
 */
export function MenuScreen({
  onPlay,
  onPropose,
  onEncyclopedia,
  onMyProposals,
  displayName,
  accountState,
  onOpenAccount,
  showConnectPrompt = false,
  onConnect,
  onConnectPromptShown,
  unreadProposalCount = 0,
  notification,
}: MenuScreenProps) {
  return (
    <div className={screen.screen}>
      <main className={screen.body}>
        <div className={styles.accountBar}>
          <AccountRow
            displayName={displayName}
            state={accountState}
            isDefaultName={isDefaultDisplayName(displayName)}
            onOpen={onOpenAccount}
          />
          {notification}
        </div>
        <BrandHero />
        <Button variant="primary" block onClick={onPlay}>
          あそぶ
        </Button>
        <Button block onClick={onPropose}>
          {PROPOSE_RULE_LABEL}
        </Button>
        <Button block onClick={onEncyclopedia}>
          ルール図鑑
        </Button>
        <div className={screen.row}>
          <Button size="small" onClick={onMyProposals}>
            マイ提案
            {unreadProposalCount > 0 && (
              <span className={styles.badge} aria-label="未読提案">
                {unreadProposalCount > 99 ? '99+' : unreadProposalCount}
              </span>
            )}
          </Button>
        </div>
        {showConnectPrompt && onConnect && (
          <ConnectPrompt
            onConnect={onConnect}
            {...(onConnectPromptShown ? { onShown: onConnectPromptShown } : {})}
          />
        )}
        <footer className={styles.appLinks}>
          {SUPPORT_URL && (
            <a href={SUPPORT_URL} target="_blank" rel="noreferrer">
              ☕ 開発を支援する
            </a>
          )}
          <a href={X_ACCOUNT_URL} target="_blank" rel="noreferrer">
            開発者X
          </a>
        </footer>
        <HillDivider />
      </main>
    </div>
  );
}

function ConnectPrompt({
  onConnect,
  onShown,
}: {
  onConnect: () => void;
  onShown?: () => void;
}) {
  useEffect(() => onShown?.(), [onShown]);
  return (
    <Callout
      action={
        <Button size="small" onClick={onConnect}>
          {GOOGLE_CONNECT_LABEL}
        </Button>
      }
    >
      今日の記録は、この端末だけに残っています。Googleでつなぐと、ほかの端末でも続きをあそべます。
    </Callout>
  );
}
