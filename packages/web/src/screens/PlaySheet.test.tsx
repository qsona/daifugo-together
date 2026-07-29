import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlaySheet } from './PlaySheet';

afterEach(cleanup);

describe('TU-01: あそぶモードの選択', () => {
  it('きほんを先頭・初心者アイコン付きで出し、選ぶとすぐ部屋を作る', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(
      <PlaySheet onCreate={onCreate} onJoin={vi.fn()} onClose={vi.fn()} />,
    );

    const choices = screen.getAllByRole('button');
    expect(choices[0]?.textContent).toBe('きほんルールであそぶ');
    expect(choices[0]?.querySelector('svg')).toBeTruthy();
    expect(screen.queryByText('はじめてのひとはこちら')).toBeNull();

    await user.click(
      screen.getByRole('button', { name: 'きほんルールであそぶ' }),
    );

    expect(onCreate).toHaveBeenCalledWith('basic');
    expect(
      screen.queryByRole('button', { name: 'じぶんの部屋をつくる' }),
    ).toBeNull();
  });

  it('3つの選択肢をすべて白いボタンで出す', () => {
    render(<PlaySheet onCreate={vi.fn()} onJoin={vi.fn()} onClose={vi.fn()} />);

    const choices = screen.getAllByRole('button');
    expect(choices).toHaveLength(3);
    expect(
      screen.getByRole('button', { name: 'きほんルールであそぶ' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'みんなのルールであそぶ' }),
    ).toBeTruthy();
    for (const choice of choices) {
      expect(choice.className).not.toContain('primary');
    }
  });

  it('みんなのルールを選ぶとすぐ作れ、入る側にはモードを要求しない', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const onJoin = vi.fn();
    render(<PlaySheet onCreate={onCreate} onJoin={onJoin} onClose={vi.fn()} />);

    await user.click(
      screen.getByRole('button', { name: 'みんなのルールであそぶ' }),
    );
    expect(onCreate).toHaveBeenCalledWith('community');

    await user.click(
      screen.getByRole('button', { name: '友だちの部屋にはいる' }),
    );
    const inviteCodeInput = screen.getByLabelText(
      '招待コード',
    ) as HTMLInputElement;
    expect(inviteCodeInput.getAttribute('inputmode')).toBe('numeric');
    await user.type(inviteCodeInput, '0A12-3456');
    expect(inviteCodeInput.value).toBe('01234');
    await user.click(screen.getByRole('button', { name: 'はいる' }));
    expect(onJoin).toHaveBeenCalledWith('01234');
  });

  it('作成失敗をモード選択肢の下へ出し、その場で再試行できる', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(
      <PlaySheet
        onCreate={onCreate}
        onJoin={vi.fn()}
        onClose={vi.fn()}
        error="みんなのルールへ進めませんでした。もう一度ためしてください"
      />,
    );

    expect(
      screen.getByRole('dialog', { name: 'あそびかたをえらぶ' }),
    ).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain(
      'もう一度ためしてください',
    );
    await user.click(
      screen.getByRole('button', { name: 'みんなのルールであそぶ' }),
    );
    expect(onCreate).toHaveBeenCalledWith('community');
  });

  it('みんなのルールへの再試行では該当ボタンを主ボタンにする', () => {
    render(
      <PlaySheet
        initialMode="community"
        onCreate={vi.fn()}
        onJoin={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'みんなのルールであそぶ' }).className,
    ).toContain('primary');
  });
});
