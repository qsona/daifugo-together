import { getSafeLocalStorage } from '../browser-storage';

const TOKEN_KEY = 'daifugo.userToken';
const DECLINED_KEY = 'daifugo.pushOfferDeclined';
export const PROPOSAL_PUSH_TYPES = [
  'proposal_released',
  'proposal_rejected',
  'proposal_failed',
] as const;

export type PushPreferences = Record<string, boolean>;
export type PushOfferResult =
  | 'subscribed'
  | 'unavailable'
  | 'unsupported'
  | 'ios_install_required'
  | 'denied';

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

function iosDevice(): boolean {
  return (
    /iPad|iPhone|iPod/u.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function standalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export class PushClient {
  readonly #baseUrl: string;
  readonly #storage: Pick<Storage, 'getItem' | 'setItem'>;
  readonly #fetch: typeof fetch;

  constructor(
    baseUrl: string,
    storage: Pick<Storage, 'getItem' | 'setItem'>,
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

  async shouldOffer(): Promise<boolean> {
    if (!this.supported() || Notification.permission === 'denied') return false;
    if (this.#storage.getItem(DECLINED_KEY) === '1') return false;
    const config = await this.config();
    if (!config.available) return false;
    const registration = await navigator.serviceWorker.getRegistration('/');
    if (!registration) return false;
    return (await registration.pushManager.getSubscription()) === null;
  }

  declineOffer(): void {
    this.#storage.setItem(DECLINED_KEY, '1');
  }

  async subscribeProposalResults(): Promise<PushOfferResult> {
    if (!this.supported()) return 'unsupported';
    if (iosDevice() && !standalone()) return 'ios_install_required';
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
    await this.setPreferences(
      Object.fromEntries(PROPOSAL_PUSH_TYPES.map((type) => [type, true])),
    );
    return 'subscribed';
  }

  async preferences(): Promise<PushPreferences> {
    const response = await this.#request('/api/push/preferences');
    return ((await response.json()) as { preferences: PushPreferences })
      .preferences;
  }

  async setPreferences(preferences: PushPreferences): Promise<PushPreferences> {
    const response = await this.#request('/api/push/preferences', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ preferences }),
    });
    return ((await response.json()) as { preferences: PushPreferences })
      .preferences;
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
