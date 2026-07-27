import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProposalListItem } from '@daifugo/core';
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
    expect(markProposalsSeen).toHaveBeenCalledWith(2);
    expect(onUnreadCountChange.mock.calls).toEqual([[2], [0]]);
  });

  it('C-6の全理由codeを固定文言または詳細理由へ変換する', async () => {
    const reasons = [
      ['infeasible_technical', '現在のしくみでは実装できませんでした。'],
      ['breaks_game', 'ゲームの成立を損なうため実装できませんでした。'],
      ['inappropriate', '安全に扱えない内容が含まれていました。'],
      ['duplicate_rule', '似たルールが既にあります。'],
      ['out_of_scope', 'ルールとして解釈できませんでした。'],
      ['other', '個別に説明するための長い理由'.repeat(30)],
      [
        'implementation_failed',
        'ルールの実装を完了できませんでした。内容を見直して再提案できます。',
      ],
    ] as const;
    const items: ProposalListItem[] = reasons.map(
      ([code, expected], index) => ({
        id: `reason-${String(index)}`,
        kind: 'original',
        prefectureCode: null,
        prefectureName: null,
        name: `理由${String(index)}`,
        body: '本文',
        status: code === 'implementation_failed' ? 'failed' : 'rejected',
        reason: { code, text: code === 'other' ? expected : '' },
        releasedRuleId: null,
        popularity: null,
        priorityRank: null,
        unread: false,
        createdAt: 1,
        statusChangedAt: index + 1,
      }),
    );
    render(
      <MyProposalsScreen
        api={{
          submit: vi.fn(),
          mine: async () => ({ items, unreadCount: 0 }),
          markProposalsSeen: async () => undefined,
        }}
        onBack={() => undefined}
      />,
    );

    expect(await screen.findByText('理由0')).toBeTruthy();
    for (const [, expected] of reasons) {
      expect(screen.getByText(expected)).toBeTruthy();
    }
  });

  it('既読更新に失敗しても取得済み一覧と未読件数を保持する', async () => {
    const onUnreadCountChange = vi.fn();
    render(
      <MyProposalsScreen
        api={{
          submit: vi.fn(),
          mine: async () => ({
            unreadCount: 1,
            items: [
              {
                id: 'unread',
                kind: 'original',
                prefectureCode: null,
                prefectureName: null,
                name: '未読の提案',
                body: '本文',
                status: 'screening',
                reason: null,
                releasedRuleId: null,
                popularity: null,
                priorityRank: null,
                unread: true,
                createdAt: 1,
                statusChangedAt: 10,
              },
            ],
          }),
          markProposalsSeen: async () => {
            throw new Error('offline');
          },
        }}
        onBack={() => undefined}
        onUnreadCountChange={onUnreadCountChange}
      />,
    );

    expect(await screen.findByText('未読の提案')).toBeTruthy();
    expect(
      await screen.findByText(
        '未読状態を更新できませんでした。もう一度開いてください。',
      ),
    ).toBeTruthy();
    expect(screen.getByText('未読')).toBeTruthy();
    expect(onUnreadCountChange.mock.calls).toEqual([[1]]);
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
