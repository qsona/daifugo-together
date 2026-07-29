import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MenuScreen } from './MenuScreen';

afterEach(cleanup);

describe('MenuScreen', () => {
  it('マイ提案に未読件数を表示し、99件を超えたら省略する', () => {
    const props = {
      onPlay: vi.fn(),
      onPropose: vi.fn(),
      onEncyclopedia: vi.fn(),
      onMyProposals: vi.fn(),
    };
    const { rerender } = render(
      <MenuScreen {...props} unreadProposalCount={3} />,
    );
    expect(screen.getByLabelText('未読提案').textContent).toBe('3');

    rerender(<MenuScreen {...props} unreadProposalCount={100} />);
    expect(screen.getByLabelText('未読提案').textContent).toBe('99+');
  });

  it('未登録はログイン、登録済みはログアウトの導線を出す', async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn();
    const onLogout = vi.fn();
    const props = {
      onPlay: vi.fn(),
      onPropose: vi.fn(),
      onEncyclopedia: vi.fn(),
      onMyProposals: vi.fn(),
      onHowToPlay: vi.fn(),
      onLogin,
      onLogout,
    };
    const view = render(<MenuScreen {...props} />);
    await user.click(
      screen.getByRole('button', { name: '引き継ぎ・ログイン' }),
    );
    expect(onLogin).toHaveBeenCalledOnce();

    view.rerender(<MenuScreen {...props} registered />);
    await user.click(
      screen.getByRole('button', { name: '登録済み・ログアウト' }),
    );
    expect(onLogout).toHaveBeenCalledOnce();
  });
});
