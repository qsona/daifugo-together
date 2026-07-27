import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlaySheet } from './PlaySheet';

afterEach(cleanup);

describe('TU-01: あそぶモードの選択', () => {
  it('未プレイではきほんを先頭・タグ付きで出し、選んだモードで部屋を作る', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(
      <PlaySheet
        onCreate={onCreate}
        onJoin={vi.fn()}
        onClose={vi.fn()}
        playedBefore={false}
      />,
    );

    const choices = screen.getAllByRole('button');
    expect(choices[0]?.textContent).toContain('きほん');
    expect(screen.getByText('はじめてのひとはこちら')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /きほん/ }));
    await user.click(
      screen.getByRole('button', { name: 'じぶんの部屋をつくる' }),
    );

    expect(onCreate).toHaveBeenCalledWith('basic');
  });

  it('既プレイではタグだけを消し、導線の形は変えない', () => {
    render(
      <PlaySheet
        onCreate={vi.fn()}
        onJoin={vi.fn()}
        onClose={vi.fn()}
        playedBefore
      />,
    );

    expect(screen.getByRole('button', { name: 'きほん' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'みんなのルール' })).toBeTruthy();
    expect(screen.queryByText('はじめてのひとはこちら')).toBeNull();
  });

  it('みんなのルールを選んで作れ、入る側にはモードを要求しない', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const onJoin = vi.fn();
    render(
      <PlaySheet
        onCreate={onCreate}
        onJoin={onJoin}
        onClose={vi.fn()}
        playedBefore
      />,
    );

    await user.click(screen.getByRole('button', { name: 'みんなのルール' }));
    await user.click(
      screen.getByRole('button', { name: 'じぶんの部屋をつくる' }),
    );
    expect(onCreate).toHaveBeenCalledWith('community');

    await user.click(screen.getByRole('button', { name: 'もどる' }));
    await user.click(
      screen.getByRole('button', { name: '友だちの部屋にはいる' }),
    );
    await user.type(screen.getByLabelText('招待コード'), 'ABCD-1234');
    await user.click(screen.getByRole('button', { name: 'はいる' }));
    expect(onJoin).toHaveBeenCalledWith('ABCD-1234');
  });

  it('community作成の再試行ではモード選択を戻さず、失敗を作成ボタンの下へ出す', () => {
    render(
      <PlaySheet
        onCreate={vi.fn()}
        onJoin={vi.fn()}
        onClose={vi.fn()}
        playedBefore
        initialMode="community"
        error="みんなのルールへ進めませんでした。もう一度ためしてください"
      />,
    );

    expect(
      screen.getByRole('dialog', { name: 'じぶんの部屋をつくる' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'じぶんの部屋をつくる' }),
    ).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain(
      'もう一度ためしてください',
    );
  });
});
