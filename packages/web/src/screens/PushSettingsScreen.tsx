import { useEffect, useState } from 'react';

import { AppBar } from '../components/AppBar';
import { Button } from '../components/Button';
import {
  PROPOSAL_PUSH_TYPES,
  type PushClient,
  type PushOfferResult,
  type PushPreferences,
} from '../push/client';

import styles from './PushSettingsScreen.module.css';
import screen from './screen.module.css';

const LABELS: Record<string, string> = {
  proposal_released: '提案がルールになった',
  proposal_rejected: '提案の確認結果が出た',
  proposal_failed: 'ルールの実装結果が出た',
};

export function PushSettingsScreen({
  api,
  onBack,
}: {
  api: Pick<
    PushClient,
    | 'preferences'
    | 'setPreferences'
    | 'disableThisDevice'
    | 'subscribeProposalResults'
    | 'config'
  >;
  onBack: () => void;
}) {
  const [preferences, setPreferences] = useState<PushPreferences | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [available, setAvailable] = useState(false);

  const subscriptionMessage = (result: PushOfferResult): string => {
    if (result === 'subscribed') return 'この端末への通知を設定しました。';
    if (result === 'ios_install_required') {
      return 'iPhone・iPadでは、ホーム画面に追加したアプリから設定してください。';
    }
    if (result === 'denied') return '端末で通知が許可されませんでした。';
    return 'この端末ではPush通知を設定できません。';
  };

  useEffect(() => {
    let active = true;
    void api.config().then(
      (config) => {
        if (active) setAvailable(config.available);
      },
      () => {
        if (active) setAvailable(false);
      },
    );
    void api.preferences().then(
      (value) => {
        if (active) setPreferences(value);
      },
      () => {
        if (active) setMessage('Push通知はまだ利用できません。');
      },
    );
    return () => {
      active = false;
    };
  }, [api]);

  const update = async (type: string, enabled: boolean) => {
    const next = { ...preferences, [type]: enabled };
    setPreferences(next);
    try {
      setPreferences(await api.setPreferences({ [type]: enabled }));
      setMessage('設定を保存しました。');
    } catch {
      setPreferences(preferences);
      setMessage('設定を保存できませんでした。');
    }
  };

  return (
    <div className={screen.screen}>
      <AppBar title="通知設定" onBack={onBack} />
      <main className={screen.body}>
        <p>
          Push通知は、アプリ内のおしらせと同じ内容だけをこの端末へ届けます。
        </p>
        {preferences && (
          <fieldset className={styles.fieldset}>
            <legend>受け取る内容</legend>
            {PROPOSAL_PUSH_TYPES.map((type) => (
              <label className={styles.preference} key={type}>
                <span>{LABELS[type]}</span>
                <input
                  type="checkbox"
                  checked={preferences[type] ?? false}
                  onChange={(event) => void update(type, event.target.checked)}
                />
              </label>
            ))}
          </fieldset>
        )}
        {available && (
          <Button
            variant="primary"
            size="small"
            disabled={pending}
            onClick={() => {
              setPending(true);
              void api
                .subscribeProposalResults()
                .then(async (result) => {
                  setMessage(subscriptionMessage(result));
                  if (result === 'subscribed') {
                    setPreferences(await api.preferences());
                  }
                })
                .catch(() => setMessage('通知を設定できませんでした。'))
                .finally(() => setPending(false));
            }}
          >
            {pending ? '設定中…' : 'この端末で通知を受け取る'}
          </Button>
        )}
        <Button
          size="small"
          onClick={() => {
            void api.disableThisDevice().then(
              () => setMessage('この端末への通知を止めました。'),
              () => setMessage('通知を止められませんでした。'),
            );
          }}
        >
          この端末への通知を止める
        </Button>
        {message && <p role="status">{message}</p>}
      </main>
    </div>
  );
}
