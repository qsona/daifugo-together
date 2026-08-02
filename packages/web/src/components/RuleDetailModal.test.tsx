import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RuleDetailModal } from './RuleDetailModal';

const ITEM = {
  id: 'r0001-eight-cut',
  name: '8切り',
  description: '8を含む手を出すと場を流し、そのプレイヤーが次の場を開始する。',
  kind: 'local' as const,
  prefecture: '埼玉県',
  status: 'active' as const,
  priority: null,
  popularity: null,
  implementedAt: '2026-07-01T00:00:00.000Z',
  removedAt: null,
};

afterEach(cleanup);

describe('RuleDetailModal', () => {
  it('名前は即座に出し、説明文は取得できてから差し込む', async () => {
    const get = vi.fn(async () => ITEM);
    render(
      <RuleDetailModal
        api={{ list: vi.fn(), get }}
        ruleId="r0001-eight-cut"
        name="8切り"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('8切り')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText(/場を流し/)).toBeTruthy();
    });
    expect(screen.queryByText(/埼玉県|都道府県/u)).toBeNull();
    expect(get).toHaveBeenCalledWith('r0001-eight-cut');
  });

  it('取得に失敗しても名前は残し、再試行できる', async () => {
    const user = userEvent.setup();
    const get = vi
      .fn()
      .mockRejectedValueOnce(new Error('rule_catalog_unavailable'))
      .mockResolvedValueOnce(ITEM);
    render(
      <RuleDetailModal
        api={{ list: vi.fn(), get }}
        ruleId="r0001-eight-cut"
        name="8切り"
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('説明を読み込めませんでした')).toBeTruthy();
    });
    expect(screen.getByText('8切り')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'もう一度ためす' }));
    await waitFor(() => {
      expect(screen.getByText(/場を流し/)).toBeTruthy();
    });
  });

  it('効果文があれば説明文の前に出す', () => {
    render(
      <RuleDetailModal
        api={{ list: vi.fn(), get: vi.fn(async () => ITEM) }}
        ruleId="r0001-eight-cut"
        name="8切り"
        effectLabel="場が流れる"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('場が流れる')).toBeTruthy();
  });

  it('閉じるボタンの戻り先をルール一覧と伝える', () => {
    render(
      <RuleDetailModal
        api={{ list: vi.fn(), get: vi.fn(async () => ITEM) }}
        ruleId="r0001-eight-cut"
        name="8切り"
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'ルール一覧に戻る' }),
    ).toBeTruthy();
  });
});
