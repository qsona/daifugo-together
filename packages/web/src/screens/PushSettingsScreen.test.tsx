import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

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

describe('PushSettingsScreen', () => {
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
