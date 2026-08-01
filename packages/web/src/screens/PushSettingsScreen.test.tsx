import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PushSettingsScreen } from './PushSettingsScreen';

function api(available: boolean) {
  return {
    config: vi.fn(async () => ({
      available,
      vapidPublicKey: available ? 'public' : null,
    })),
    preferences: vi.fn(async () => ({
      proposal_released: false,
      proposal_rejected: false,
      proposal_failed: false,
    })),
    setPreferences: vi.fn(
      async (preferences: Record<string, boolean>) => preferences,
    ),
    disableThisDevice: vi.fn(async () => undefined),
    subscribeProposalResults: vi.fn(async () => 'subscribed' as const),
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PushSettingsScreen', () => {
  it('iOSのタブでは購読ボタンではなく追加手順を出す', async () => {
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Version/17.5 Mobile/15E148 Safari/604.1',
      platform: 'iPhone',
      maxTouchPoints: 5,
    });
    const available = api(true);
    render(<PushSettingsScreen api={available} onBack={() => undefined} />);
    expect(
      await screen.findByText(
        'iPhone・iPadでは、ホーム画面に追加したアプリだけが通知を受け取れます。',
      ),
    ).toBeTruthy();
    expect(screen.getByText('「ホーム画面に追加」')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'この端末で通知を受け取る' }),
    ).toBeNull();
  });

  it('VAPID未設定環境では購読導線を出さない', async () => {
    const unavailable = api(false);
    render(<PushSettingsScreen api={unavailable} onBack={() => undefined} />);
    expect(
      await screen.findByText(
        'Push通知は、アプリ内のおしらせと同じ内容だけをこの端末へ届けます。',
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', {
        name: 'この端末で通知を受け取る',
      }),
    ).toBeNull();
  });

  it('設定画面から購読を再試行できる', async () => {
    const available = api(true);
    render(<PushSettingsScreen api={available} onBack={() => undefined} />);
    const enable = await screen.findByRole('button', {
      name: 'この端末で通知を受け取る',
    });
    await userEvent.click(enable);
    expect(available.subscribeProposalResults).toHaveBeenCalledOnce();
    expect(
      await screen.findByText('この端末への通知を設定しました。'),
    ).toBeTruthy();
  });
});
