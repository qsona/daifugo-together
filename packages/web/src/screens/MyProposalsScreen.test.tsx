import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ProposalApi } from '../proposal/client';
import { MyProposalsScreen } from './MyProposalsScreen';

afterEach(cleanup);

describe('MyProposalsScreen', () => {
  it('状態・理由・未読・リリース導線を表示して明示的に既読化する', async () => {
    const markProposalsSeen = vi.fn(async () => undefined);
    const onUnreadCountChange = vi.fn();
    const api: ProposalApi = {
      submit: vi.fn(),
      mine: async () => ({
        unreadCount: 2,
        items: [
          {
            id: 'released',
            kind: 'local',
            prefectureCode: '11',
            prefectureName: '埼玉県',
            name: '公開ルール',
            body: '公開された本文',
            status: 'released',
            reason: null,
            releasedRuleId: 'r0001-release',
            popularity: null,
            priorityRank: null,
            unread: true,
            createdAt: 1,
            statusChangedAt: 2,
          },
          {
            id: 'failed',
            kind: 'original',
            prefectureCode: null,
            prefectureName: null,
            name: '失敗ルール',
            body: '失敗した本文',
            status: 'failed',
            reason: {
              code: 'implementation_failed',
              text: '実装を完了できませんでした',
            },
            releasedRuleId: null,
            popularity: null,
            priorityRank: null,
            unread: true,
            createdAt: 1,
            statusChangedAt: 2,
          },
        ],
      }),
      markProposalsSeen,
    };

    render(
      <MyProposalsScreen
        api={api}
        onBack={() => undefined}
        onUnreadCountChange={onUnreadCountChange}
      />,
    );

    expect(await screen.findByText('公開ルール')).toBeTruthy();
    expect(screen.getByText('ローカル（報告: 埼玉県）')).toBeTruthy();
    expect(screen.getByText('ルール図鑑: r0001-release')).toBeTruthy();
    expect(screen.getByText('実装を完了できませんでした')).toBeTruthy();
    expect(screen.getAllByText('未読')).toHaveLength(2);
    await waitFor(() => expect(markProposalsSeen).toHaveBeenCalledOnce());
    expect(onUnreadCountChange.mock.calls).toEqual([[2], [0]]);
  });

  it('戻る操作と空表示を提供する', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(
      <MyProposalsScreen
        api={{
          submit: vi.fn(),
          mine: async () => ({ items: [], unreadCount: 0 }),
          markProposalsSeen: async () => undefined,
        }}
        onBack={onBack}
      />,
    );

    expect(await screen.findByText('まだ提案はありません。')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'もどる' }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
