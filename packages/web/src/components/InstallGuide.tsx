import { useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';

import {
  detectInstallEnvironment,
  installPromptReady,
  promptInstall,
  subscribeInstallPrompt,
  type InstallEnvironment,
} from '../push/install';

import { Button } from './Button';
import styles from './InstallGuide.module.css';

/** iOS の共有ボタンの絵。文字だけの案内では低学年がたどり着けないため図で示す。 */
function ShareIcon() {
  return (
    <svg
      className={styles.icon}
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3v11" />
      <path d="M8 7l4-4 4 4" />
      <path d="M5 12v8h14v-8" />
    </svg>
  );
}

function iosSteps(environment: InstallEnvironment): ReactNode[] {
  const share =
    environment.browser === 'safari'
      ? [
          <>
            画面のいちばん下にある共有ボタン <ShareIcon /> を押す
          </>,
        ]
      : [
          <>
            画面の上のほうにある共有ボタン <ShareIcon />
            （見つからないときは「…」メニューの中）を押す
          </>,
        ];
  return [
    ...share,
    <>
      メニューを下にたどって<strong>「ホーム画面に追加」</strong>を押す
    </>,
    <>ホーム画面にできたアイコンから、このゲームを開く</>,
  ];
}

/**
 * ホーム画面追加(A2HS)の手順案内。
 * iOS には追加を促す API が無く(beforeinstallprompt は Chromium 系のみ)、
 * 手動操作しかないため、案内の分かりやすさがそのまま到達率になる(E17 §2.2)。
 */
export function InstallGuide({
  environment = detectInstallEnvironment(),
}: {
  environment?: InstallEnvironment;
}) {
  const promptReady = useSyncExternalStore(
    subscribeInstallPrompt,
    installPromptReady,
    () => false,
  );
  const [copied, setCopied] = useState(false);
  const [installing, setInstalling] = useState(false);

  if (environment.standalone) return null;

  if (environment.inApp) {
    return (
      <div className={styles.guide}>
        <p className={styles.lead}>
          いま開いているアプリの中のブラウザからは、ホーム画面に追加できません。
        </p>
        <ol className={styles.steps}>
          <li>
            画面のメニューから
            <strong>「{environment.ios ? 'Safari' : 'ブラウザ'}で開く」</strong>
            を選ぶ
          </li>
          <li>開いたブラウザで、共有メニューから「ホーム画面に追加」を選ぶ</li>
        </ol>
        {typeof navigator.clipboard !== 'undefined' && (
          <Button
            size="small"
            onClick={() => {
              void navigator.clipboard
                .writeText(window.location.href)
                .then(() => setCopied(true))
                .catch(() => setCopied(false));
            }}
          >
            {copied ? 'コピーしました' : 'リンクをコピーする'}
          </Button>
        )}
      </div>
    );
  }

  if (environment.ios) {
    return (
      <div className={styles.guide}>
        <ol className={styles.steps}>
          {iosSteps(environment).map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
        <p className={styles.note}>
          ホーム画面のアプリはブラウザとは別のアプリとして開きます。追加したあとは、もう一度Googleでログインしてください。
        </p>
      </div>
    );
  }

  if (promptReady) {
    return (
      <div className={styles.guide}>
        <p className={styles.lead}>
          ホーム画面に追加すると、アイコンからすぐに開けます。
        </p>
        <Button
          variant="primary"
          size="small"
          disabled={installing}
          onClick={() => {
            setInstalling(true);
            void promptInstall().finally(() => setInstalling(false));
          }}
        >
          {installing ? '追加中…' : 'アプリとして追加'}
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.guide}>
      <p className={styles.lead}>
        ブラウザのメニューから「アプリをインストール」または「ホーム画面に追加」を選ぶと、アイコンからすぐに開けます。
      </p>
    </div>
  );
}
