import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MenuScreen } from './MenuScreen';

afterEach(cleanup);

describe('MenuScreen', () => {
  it('フッターに支援と開発者Xの外部リンクを出す', () => {
    render(
      <MenuScreen
        onPlay={vi.fn()}
        onPropose={vi.fn()}
        onEncyclopedia={vi.fn()}
        onMyProposals={vi.fn()}
        displayName="ゲスト000001"
        accountState="anonymous"
        onOpenAccount={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('link', { name: '☕ 開発を支援する' }),
    ).toHaveProperty('href', 'https://ofuse.me/qsona');
    expect(screen.getByRole('link', { name: '開発者X' })).toHaveProperty(
      'href',
      'https://x.com/qsona',
    );
  });

  it('マイ提案に未読件数を表示し、99件を超えたら省略する', () => {
    const props = {
      onPlay: vi.fn(),
      onPropose: vi.fn(),
      onEncyclopedia: vi.fn(),
      onMyProposals: vi.fn(),
      displayName: 'ゲスト000001',
      accountState: 'anonymous' as const,
      onOpenAccount: vi.fn(),
    };
    const { rerender } = render(
      <MenuScreen {...props} unreadProposalCount={3} />,
    );
    expect(screen.getByLabelText('未読提案').textContent).toBe('3');

    rerender(<MenuScreen {...props} unreadProposalCount={100} />);
    expect(screen.getByLabelText('未読提案').textContent).toBe('99+');
  });

  it('アカウント行は操作せず記録画面を開く', async () => {
    const user = userEvent.setup();
    const onOpenAccount = vi.fn();
    const props = {
      onPlay: vi.fn(),
      onPropose: vi.fn(),
      onEncyclopedia: vi.fn(),
      onMyProposals: vi.fn(),
      displayName: 'ゲスト000001',
      accountState: 'anonymous' as const,
      onOpenAccount,
    };
    render(<MenuScreen {...props} />);
    await user.click(screen.getByRole('button', { name: /記録を開く/ }));
    expect(onOpenAccount).toHaveBeenCalledOnce();
    expect(screen.queryByText('引き継ぎ・ログイン')).toBeNull();
  });
});
