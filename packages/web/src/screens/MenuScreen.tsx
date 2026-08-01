import { BrandHero, HillDivider } from '../components/BrandHero';
import { Button } from '../components/Button';
import type { ReactNode } from 'react';

import styles from './MenuScreen.module.css';
import screen from './screen.module.css';

type MenuScreenProps = {
  onPlay: () => void;
  onPropose: () => void;
  onEncyclopedia: () => void;
  onMyProposals: () => void;
  registered?: boolean;
  onLogin?: () => void;
  onLogout?: () => void;
  authPending?: boolean;
  authMessage?: string | null;
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
  registered = false,
  onLogin,
  onLogout,
  authPending = false,
  authMessage = null,
  unreadProposalCount = 0,
  notification,
}: MenuScreenProps) {
  return (
    <div className={screen.screen}>
      <main className={screen.body}>
        {notification && (
          <div className={styles.notification}>{notification}</div>
        )}
        <BrandHero />
        <Button variant="primary" block onClick={onPlay}>
          あそぶ
        </Button>
        <Button block onClick={onPropose}>
          ルールをていあんする
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
        {onLogin && onLogout && (
          <Button
            size="small"
            disabled={authPending}
            onClick={registered ? onLogout : onLogin}
          >
            {registered ? '登録済み・ログアウト' : '引き継ぎ・ログイン'}
          </Button>
        )}
        {authMessage && <p role="status">{authMessage}</p>}
        <HillDivider />
      </main>
    </div>
  );
}
