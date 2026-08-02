import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccountScreen } from './AccountScreen';

afterEach(cleanup);

const actions = {
  onBack: vi.fn(),
  onRename: vi.fn(),
  onOpenProposals: vi.fn(),
  onConnect: vi.fn(),
  onSwitch: vi.fn(),
  onSignOut: vi.fn(),
};

describe('AccountScreen', () => {
  it('未登録の記録と件数を表示して接続ダイアログを開く', async () => {
    const onConnect = vi.fn();
    render(
      <AccountScreen
        api={{
          mine: vi.fn(async () => ({ items: [], unreadCount: 0 })),
          getYellowCards: vi.fn(async () => ({
            active: 0,
            limit: 2 as const,
            cards: [],
            suspension: null,
          })),
        }}
        displayName="ゲスト000001"
        registered={false}
        connection="ready"
        {...actions}
        onConnect={onConnect}
      />,
    );
    await waitFor(() => expect(screen.getByText('提案 0件')).toBeTruthy());
    // イエローカードは 1 枚以上のときだけ表示する
    expect(screen.queryByText(/イエローカード/u)).toBeNull();
    await userEvent.click(
      screen.getByRole('button', { name: 'Googleでつなぐ' }),
    );
    expect(onConnect).toHaveBeenCalledOnce();
    expect(screen.queryByText('サインアウト')).toBeNull();
  });

  it('登録済みでは切替とサインアウトを分け、件数失敗はダッシュにする', async () => {
    render(
      <AccountScreen
        api={{
          mine: vi.fn(async () => Promise.reject(new Error('offline'))),
          getYellowCards: vi.fn(async () =>
            Promise.reject(new Error('offline')),
          ),
        }}
        displayName="たろう"
        registered
        connection="ready"
        {...actions}
      />,
    );
    expect(screen.getByText('提案 —')).toBeTruthy();
    expect(screen.queryByText(/イエローカード/u)).toBeNull();
    expect(
      screen.getByRole('button', { name: '別のアカウントにする' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'サインアウト' })).toBeTruthy();
  });
});
