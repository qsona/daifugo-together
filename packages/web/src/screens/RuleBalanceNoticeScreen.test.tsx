import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RuleBalanceNoticeScreen } from './RuleBalanceNoticeScreen';

afterEach(cleanup);

describe('RuleBalanceNoticeScreen', () => {
  it('反映日と3ルールの変更前・変更後・理由を表示し、お知らせへ戻る', async () => {
    const onBack = vi.fn();
    render(<RuleBalanceNoticeScreen releasedOn="2026-08-22" onBack={onBack} />);

    expect(
      screen.getByRole('heading', { name: 'ルール調整のお知らせ' }),
    ).toBeTruthy();
    expect(screen.getByText('反映日: 2026年8月22日')).toBeTruthy();
    for (const name of ['ラッキー7', 'ボンバーマン', 'リアルボンバー']) {
      const section = screen.getByRole('heading', { name }).closest('section');
      expect(section?.textContent).toContain('変更前');
      expect(section?.textContent).toContain('変更後');
      expect(section?.textContent).toContain('変更理由');
    }

    await userEvent.click(screen.getByRole('button', { name: 'もどる' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('不正な反映日を日付として表示しない', () => {
    render(
      <RuleBalanceNoticeScreen
        releasedOn="2026-02-30"
        onBack={() => undefined}
      />,
    );
    expect(screen.getByText('反映日を確認できませんでした')).toBeTruthy();
  });
});
