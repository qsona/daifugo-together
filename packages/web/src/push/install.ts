/**
 * ホーム画面追加(A2HS)まわりの環境判定と、Chromium 系のインストールプロンプト保持。
 *
 * iOS/iPadOS では Web Push はホーム画面に追加した Web App でしか使えず、
 * Safari のタブでは `Notification` / `PushManager` 自体が存在しない(E17 §2.2)。
 * そのため「Push が使えるか」ではなく「Push を使えるようにできるか」を先に判定する必要がある。
 */

export type InstallBrowser = 'safari' | 'chrome' | 'firefox' | 'edge' | 'other';

export type InstallEnvironment = {
  ios: boolean;
  standalone: boolean;
  /** LINE・X・Instagram などのアプリ内ブラウザ。ここからはホーム画面に追加できない。 */
  inApp: boolean;
  /** 共有メニューの位置が異なるため、案内の出し分けにブラウザ種別まで見る。 */
  browser: InstallBrowser;
};

/** アプリ内ブラウザは推測に頼らず、名乗っているものだけを拾う。 */
const IN_APP_TOKENS = [
  'Line/',
  'FBAN',
  'FBAV',
  'FB_IAB',
  'Instagram',
  'Twitter',
  'MicroMessenger',
];

function browserOf(userAgent: string, ios: boolean): InstallBrowser {
  if (/CriOS/u.test(userAgent)) return 'chrome';
  if (/FxiOS/u.test(userAgent)) return 'firefox';
  if (/EdgiOS|Edg\//u.test(userAgent)) return 'edge';
  if (ios) return 'safari';
  if (/Firefox/u.test(userAgent)) return 'firefox';
  if (/Chrome/u.test(userAgent)) return 'chrome';
  if (/Safari/u.test(userAgent)) return 'safari';
  return 'other';
}

export function detectInstallEnvironment(
  navigatorLike: Navigator = navigator,
  windowLike: Window = window,
): InstallEnvironment {
  const userAgent = navigatorLike.userAgent ?? '';
  const ios =
    /iPad|iPhone|iPod/u.test(userAgent) ||
    (navigatorLike.platform === 'MacIntel' && navigatorLike.maxTouchPoints > 1);
  // matchMedia が無い環境(jsdom など)でも判定を落とさない。
  const standalone =
    (typeof windowLike.matchMedia === 'function' &&
      windowLike.matchMedia('(display-mode: standalone)').matches) ||
    (navigatorLike as Navigator & { standalone?: boolean }).standalone === true;
  return {
    ios,
    standalone,
    inApp: IN_APP_TOKENS.some((token) => userAgent.includes(token)),
    browser: browserOf(userAgent, ios),
  };
}

export function iosDevice(): boolean {
  return detectInstallEnvironment().ios;
}

export function standalone(): boolean {
  return detectInstallEnvironment().standalone;
}

/** iOS で、ホーム画面に追加しない限り Push を設定できない状態か。 */
export function installRequired(): boolean {
  const environment = detectInstallEnvironment();
  return environment.ios && !environment.standalone;
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * `beforeinstallprompt` は起動直後に一度だけ飛ぶので、
 * 案内 UI が開かれる前に受け取って保持しておく(Chromium 系のみ)。
 */
export function watchInstallPrompt(target: Window = window): void {
  target.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  });
  target.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify();
  });
}

export function installPromptReady(): boolean {
  return deferredPrompt !== null;
}

export function subscribeInstallPrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function promptInstall(): Promise<
  'accepted' | 'dismissed' | 'unavailable'
> {
  const event = deferredPrompt;
  if (!event) return 'unavailable';
  // プロンプトは一度しか使えない。結果に関わらず破棄する。
  deferredPrompt = null;
  notify();
  try {
    await event.prompt();
    return (await event.userChoice).outcome;
  } catch {
    return 'unavailable';
  }
}

/** テスト用に保持中のプロンプトを捨てる。 */
export function resetInstallPrompt(): void {
  deferredPrompt = null;
  notify();
}
