import { useEffect, useState } from 'react';

import { AppBar } from '../components/AppBar';
import { Button } from '../components/Button';
import { Callout } from '../components/Callout';
import { InstallGuide } from '../components/InstallGuide';
import { RETRY_GENERIC_ERROR } from '../messages';
import { GOOGLE_CONNECT_LABEL } from '../messages';
import { detectInstallEnvironment } from '../push/install';
import type { PushClient, PushOfferResult } from '../push/client';

import styles from './PushSettingsScreen.module.css';
import screen from './screen.module.css';

export function PushSettingsScreen({
  api,
  onBack,
  registered,
  onLogin,
}: {
  api: Pick<
    PushClient,
    'disableThisDevice' | 'subscribeProposalResults' | 'config'
  >;
  onBack: () => void;
  registered: boolean;
  onLogin: () => boolean | void;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [available, setAvailable] = useState(false);
  const [environment] = useState(() => detectInstallEnvironment());
  // iOS のタブでは購読自体ができないため、購読ボタンではなく追加手順を出す(E17 §2.2)。
  const installRequired = environment.ios && !environment.standalone;

  const subscriptionMessage = (result: PushOfferResult): string => {
    if (result === 'subscribed') return 'この端末への通知を設定しました。';
    if (result === 'ios_install_required') {
      return 'iPhone・iPadでは、ホーム画面に追加したアプリだけが通知を受け取れます。下の手順で追加してください。';
    }
    if (result === 'denied') return '端末で通知が許可されませんでした。';
    return 'この端末ではPush通知を設定できません。';
  };

  useEffect(() => {
    if (!registered) return;
    let active = true;
    void api.config().then(
      (config) => {
        if (active) setAvailable(config.available);
      },
      () => {
        if (active) setAvailable(false);
      },
    );
    return () => {
      active = false;
    };
  }, [api, registered]);

  return (
    <div className={screen.screen}>
      <AppBar title="通知設定" onBack={onBack} />
      <main className={screen.body}>
        <p>
          提案の結果が出たとき、アプリ内のおしらせと同じ内容をこの端末へ届けます。
        </p>
        {!registered && (
          <Callout
            action={
              <Button
                size="small"
                onClick={() => {
                  if (onLogin() === false) setMessage(RETRY_GENERIC_ERROR);
                }}
              >
                {GOOGLE_CONNECT_LABEL}
              </Button>
            }
          >
            Push通知を受け取るには、Googleでつないでください。
          </Callout>
        )}
        {registered && !environment.standalone && (
          <section className={styles.install}>
            <h2 className={styles.installTitle}>ホーム画面に追加する</h2>
            {installRequired && (
              <p className={styles.installLead}>
                iPhone・iPadでは、ホーム画面に追加したアプリだけが通知を受け取れます。
              </p>
            )}
            <InstallGuide environment={environment} />
          </section>
        )}
        {registered && available && !installRequired && (
          <Button
            variant="primary"
            size="small"
            disabled={pending}
            onClick={() => {
              setPending(true);
              void api
                .subscribeProposalResults()
                .then((result) => {
                  setMessage(subscriptionMessage(result));
                })
                .catch(() => setMessage('通知を設定できませんでした。'))
                .finally(() => setPending(false));
            }}
          >
            {pending ? '設定中…' : 'この端末で通知を受け取る'}
          </Button>
        )}
        {registered && (
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
        )}
        {message && <p role="status">{message}</p>}
      </main>
    </div>
  );
}
