import { getSafeLocalStorage } from '../browser-storage';
import { installRequired, standalone } from './install';

const TOKEN_KEY = 'daifugo.userToken';
const DECLINED_KEY = 'daifugo.pushOfferDeclined';
const OFFER_AFTER_LOGIN_KEY = 'daifugo.pushOfferAfterLogin';
export type PushOfferResult =
  | 'subscribed'
  | 'unavailable'
  | 'unsupported'
  | 'ios_install_required'
  | 'denied';
/**
 * 提案送信直後に出す提示の種類。
 * iOS のタブでは Push API 自体が無いので、購読ではなくホーム画面追加の案内になる。
 */
export type PushOfferKind = 'push' | 'install';

function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const decoded = atob(
    (value + padding).replaceAll('-', '+').replaceAll('_', '/'),
  );
  const buffer = new ArrayBuffer(decoded.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
}

export class PushClient {
  readonly #baseUrl: string;
  readonly #storage: Pick<Storage, 'getItem' | 'setItem'> &
    Partial<Pick<Storage, 'removeItem'>>;
  readonly #fetch: typeof fetch;
  #installReported = false;

  constructor(
    baseUrl: string,
    storage: Pick<Storage, 'getItem' | 'setItem'> &
      Partial<Pick<Storage, 'removeItem'>>,
    fetcher: typeof fetch = fetch,
  ) {
    this.#baseUrl = baseUrl;
    this.#storage = storage;
    this.#fetch = (...args) => fetcher(...args);
  }

  supported(): boolean {
    return (
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    );
  }

  /**
   * 何を提示すべきか。`supported()` を先に見ると iOS のタブでは常に何も出せなくなるため、
   * ホーム画面追加の判定を先に置く(E17 §2.2)。
   */
  async offer(): Promise<PushOfferKind | null> {
    if (this.#storage.getItem(DECLINED_KEY) === '1') return null;
    const config = await this.config();
    if (!config.available) return null;
    if (installRequired()) return 'install';
    if (!this.supported() || Notification.permission === 'denied') return null;
    const registration = await navigator.serviceWorker.getRegistration('/');
    if (!registration) return null;
    return (await registration.pushManager.getSubscription()) === null
      ? 'push'
      : null;
  }

  declineOffer(): void {
    this.#storage.setItem(DECLINED_KEY, '1');
  }

  offerDeclined(): boolean {
    return this.#storage.getItem(DECLINED_KEY) === '1';
  }

  markOfferAfterLogin(): void {
    this.#storage.setItem(OFFER_AFTER_LOGIN_KEY, '1');
  }

  consumeOfferAfterLogin(): boolean {
    const marked = this.#storage.getItem(OFFER_AFTER_LOGIN_KEY) === '1';
    if (this.#storage.removeItem) {
      this.#storage.removeItem(OFFER_AFTER_LOGIN_KEY);
    } else {
      this.#storage.setItem(OFFER_AFTER_LOGIN_KEY, '');
    }
    return marked;
  }

  async subscribeProposalResults(): Promise<PushOfferResult> {
    // iOS のタブでは Notification/PushManager が存在しないため、
    // supported() より先に判定しないと「非対応」と誤って伝えてしまう。
    if (installRequired()) return 'ios_install_required';
    if (!this.supported()) return 'unsupported';
    // WebKit を含むブラウザの user activation を失わないよう、
    // クリックから最初の非同期処理として許諾を要求する。
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return 'denied';
    const config = await this.config();
    if (!config.available || !config.vapidPublicKey) return 'unavailable';
    const registration = await navigator.serviceWorker.getRegistration('/');
    if (!registration) return 'unavailable';
    const existing = await registration.pushManager.getSubscription();
    const current =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(config.vapidPublicKey),
      }));
    await this.#request('/api/push/subscriptions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(current.toJSON()),
    });
    return 'subscribed';
  }

  /**
   * ホーム画面アプリとして起動していることを 1 セッションに 1 回だけ記録する(E17 §2.7)。
   * 計測が落ちてもアプリの動作には影響させない。
   */
  async reportInstalled(): Promise<void> {
    if (this.#installReported || !standalone()) return;
    this.#installReported = true;
    try {
      const config = await this.config();
      if (!config.available) return;
      await this.#request('/api/push/installed', { method: 'POST' });
    } catch {
      // 計測のみ。失敗は無視する。
    }
  }

  async disableThisDevice(): Promise<void> {
    if (!('serviceWorker' in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration('/');
    if (!registration) return;
    const current = await registration.pushManager.getSubscription();
    if (!current) return;
    try {
      await this.#request('/api/push/subscriptions', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(current.toJSON()),
      });
    } finally {
      await current.unsubscribe();
    }
  }

  async config(): Promise<{
    vapidPublicKey: string | null;
    available: boolean;
  }> {
    const response = await this.#fetch(`${this.#baseUrl}/api/push/config`);
    if (!response.ok) return { vapidPublicKey: null, available: false };
    return (await response.json()) as {
      vapidPublicKey: string | null;
      available: boolean;
    };
  }

  async #request(path: string, init: RequestInit = {}): Promise<Response> {
    const token = this.#storage.getItem(TOKEN_KEY);
    if (!token) throw new Error('unauthorized');
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`push_api_${String(response.status)}`);
    return response;
  }
}

let browserClient: PushClient | undefined;

export function getBrowserPushClient(): PushClient {
  browserClient ??= new PushClient(
    window.location.origin,
    getSafeLocalStorage(window),
  );
  return browserClient;
}
