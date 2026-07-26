import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ProposalApi } from '../proposal/client';
import { ProposalFormScreen } from './ProposalFormScreen';

afterEach(() => {
  cleanup();
});

describe('ProposalFormScreen', () => {
  it('区分と任意の都道府県を選んで提案し、審査中の結果を表示する', async () => {
    const user = userEvent.setup();
    const submit = vi.fn<ProposalApi['submit']>().mockResolvedValue({
      outcome: 'accepted',
      proposal: {
        id: 'proposal-1',
        kind: 'local',
        prefectureCode: '11',
        prefectureName: '埼玉県',
        name: '8切り',
        body: '8を出すと場が流れる。',
        status: 'screening',
        reason: null,
        releasedRuleId: null,
        popularity: null,
        priorityRank: null,
        unread: true,
        createdAt: 1,
        statusChangedAt: 1,
      },
    });
    render(<ProposalFormScreen api={{ submit }} onBack={() => undefined} />);

    await user.selectOptions(
      screen.getByLabelText('遊んでいた都道府県（任意）'),
      '11',
    );
    await user.type(screen.getByLabelText('ルール名'), '8切り');
    await user.type(
      screen.getByLabelText('ルールの内容'),
      '8を出すと場が流れる。',
    );
    await user.click(screen.getByRole('button', { name: '提案を送信する' }));

    expect(submit).toHaveBeenCalledWith({
      kind: 'local',
      prefectureCode: '11',
      name: '8切り',
      body: '8を出すと場が流れる。',
    });
    expect((await screen.findByRole('status')).textContent).toBe('8切り審査中');
  });

  it('オリジナルへ切り替えると都道府県入力を隠す', async () => {
    const user = userEvent.setup();
    render(
      <ProposalFormScreen api={{ submit: vi.fn() }} onBack={() => undefined} />,
    );

    await user.click(screen.getByRole('radio', { name: 'オリジナルルール' }));

    expect(screen.queryByLabelText('遊んでいた都道府県（任意）')).toBeNull();
  });
});
