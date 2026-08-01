import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  detectInstallEnvironment,
  installPromptReady,
  installRequired,
  promptInstall,
  resetInstallPrompt,
  watchInstallPrompt,
} from './install';

const IOS_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IOS_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1';
const IOS_LINE = `${IOS_SAFARI} Line/14.9.0`;
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';

function environment(userAgent: string, standalone = false) {
  return detectInstallEnvironment(
    { userAgent, platform: 'iPhone', maxTouchPoints: 5 } as Navigator,
    {
      matchMedia: () => ({ matches: standalone }) as MediaQueryList,
    } as unknown as Window,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetInstallPrompt();
});

describe('detectInstallEnvironment', () => {
  it('iOSのブラウザ種別とアプリ内ブラウザを見分ける', () => {
    expect(environment(IOS_SAFARI)).toMatchObject({
      ios: true,
      standalone: false,
      inApp: false,
      browser: 'safari',
    });
    expect(environment(IOS_CHROME).browser).toBe('chrome');
    expect(environment(IOS_LINE).inApp).toBe(true);
    expect(environment(ANDROID_CHROME)).toMatchObject({
      ios: false,
      inApp: false,
      browser: 'chrome',
    });
  });

  it('ホーム画面から起動していればstandaloneになる', () => {
    expect(environment(IOS_SAFARI, true).standalone).toBe(true);
  });
});

describe('installRequired', () => {
  it('iOSのタブでだけホーム画面追加を要求する', () => {
    vi.stubGlobal('navigator', {
      userAgent: IOS_SAFARI,
      platform: 'iPhone',
      maxTouchPoints: 5,
    });
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: false }),
    });
    expect(installRequired()).toBe(true);

    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
    expect(installRequired()).toBe(false);

    vi.stubGlobal('navigator', {
      userAgent: ANDROID_CHROME,
      platform: 'Linux armv8l',
      maxTouchPoints: 5,
    });
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    expect(installRequired()).toBe(false);
  });
});

describe('インストールプロンプト', () => {
  it('beforeinstallpromptを保持し、一度だけ使う', async () => {
    const handlers: Record<string, (event: Event) => void> = {};
    watchInstallPrompt({
      addEventListener: (type: string, handler: (event: Event) => void) => {
        handlers[type] = handler;
      },
    } as unknown as Window);
    expect(installPromptReady()).toBe(false);

    const prompt = vi.fn(async () => undefined);
    const event = {
      preventDefault: vi.fn(),
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    };
    handlers.beforeinstallprompt!(event as unknown as Event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(installPromptReady()).toBe(true);

    await expect(promptInstall()).resolves.toBe('accepted');
    expect(prompt).toHaveBeenCalledOnce();
    expect(installPromptReady()).toBe(false);
    await expect(promptInstall()).resolves.toBe('unavailable');
  });
});
