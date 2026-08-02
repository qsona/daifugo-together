import { useEffect, useState } from 'react';

import { AppBar } from '../components/AppBar';
import { Button } from '../components/Button';
import { Tag } from '../components/Tag';
import { GOOGLE_CONNECT_LABEL, SIGN_OUT_LABEL } from '../messages';
import type { ProposalApi } from '../proposal/client';

import styles from './AccountScreen.module.css';
import screen from './screen.module.css';

type AccountApi = Partial<Pick<ProposalApi, 'mine' | 'getYellowCards'>>;

export function AccountScreen({
  api,
  displayName,
  registered,
  connection,
  onBack,
  onRename,
  onOpenProposals,
  onConnect,
  onSwitch,
  onSignOut,
}: {
  api: AccountApi;
  displayName: string | null;
  registered: boolean;
  connection: 'connecting' | 'ready' | 'superseded';
  onBack: () => void;
  onRename: () => void;
  onOpenProposals: () => void;
  onConnect: () => void;
  onSwitch: () => void;
  onSignOut: () => void;
}) {
  const [proposalCount, setProposalCount] = useState<number | null>(null);
  const [yellowCardCount, setYellowCardCount] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    if (api.mine) {
      void api
        .mine()
        .then((response) => {
          if (active) setProposalCount(response.items.length);
        })
        .catch(() => undefined);
    }
    if (api.getYellowCards) {
      void api
        .getYellowCards()
        .then((response) => {
          if (active) setYellowCardCount(response.active);
        })
        .catch(() => undefined);
    }
    return () => {
      active = false;
    };
  }, [api]);

  const connected = connection === 'ready';
  return (
    <div className={screen.screen}>
      <AppBar title="記録" onBack={onBack} />
      <main className={screen.body}>
        <section className={styles.identity} aria-label="なまえ">
          <strong>{displayName ?? '—'}</strong>
          <Button size="small" onClick={onRename}>
            なまえを変える
          </Button>
        </section>

        <section className={styles.summary} aria-label="記録の中身">
          <div className={styles.summaryRow}>
            <span>
              提案 {proposalCount === null ? '—' : `${String(proposalCount)}件`}
            </span>
            <Button size="small" onClick={onOpenProposals}>
              見る
            </Button>
          </div>
          {yellowCardCount !== null && yellowCardCount > 0 && (
            <div className={styles.summaryRow}>
              <span>イエローカード {String(yellowCardCount)}枚</span>
            </div>
          )}
        </section>

        <div className={styles.state}>
          <Tag variant={registered ? 'accountActive' : 'account'}>
            {registered ? 'Googleでつないである' : '記録はこの端末だけ'}
          </Tag>
        </div>

        {!registered ? (
          <Button
            variant="primary"
            block
            disabled={!connected}
            onClick={onConnect}
          >
            {GOOGLE_CONNECT_LABEL}
          </Button>
        ) : (
          <div className={styles.accountActions}>
            <Button block disabled={!connected} onClick={onSwitch}>
              別のアカウントにする
            </Button>
            <Button block onClick={onSignOut}>
              {SIGN_OUT_LABEL}
            </Button>
          </div>
        )}
        {!connected && (
          <p className={styles.connection} role="status">
            サーバーとつながるまで待ってください
          </p>
        )}
      </main>
    </div>
  );
}
