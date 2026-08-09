import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccountRow, isDefaultDisplayName } from './AccountRow';

afterEach(cleanup);

describe('AccountRow', () => {
  it.each([
    ['anonymous', 'ゲスト', false],
    ['registered', null, false],
    ['pending', 'ログイン中', true],
    ['connecting', '接続中', true],
  ] as const)('%s の状態と操作可否を表示する', (state, label, disabled) => {
    render(
      <AccountRow
        displayName="ゲスト000001"
        state={state}
        isDefaultName
        onOpen={vi.fn()}
      />,
    );
    if (label === null) {
      // 登録済みは通常状態なのでバッジを出さない
      expect(screen.queryByText('どの端末でも')).toBeNull();
      expect(screen.queryByText('ゲスト')).toBeNull();
    } else {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(disabled);
    if (state === 'connecting') expect(screen.getByText('—')).toBeTruthy();
  });

  it('押すと記録画面を開くだけである', async () => {
    const onOpen = vi.fn();
    render(
      <AccountRow
        displayName="たろう"
        state="anonymous"
        isDefaultName={false}
        onOpen={onOpen}
      />,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('未ログインではゲストバッジの代わりにログインを常設する', async () => {
    const onLogin = vi.fn();
    const onOpen = vi.fn();
    render(
      <AccountRow
        displayName="ゲスト000001"
        state="anonymous"
        isDefaultName
        onOpen={onOpen}
        onLogin={onLogin}
      />,
    );
    expect(screen.queryByText('ゲスト')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'ログイン' }));
    expect(onLogin).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /記録を開く/u }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('ログイン済みにはログインを出さない', () => {
    render(
      <AccountRow
        displayName="たろう"
        state="registered"
        isDefaultName={false}
        onOpen={vi.fn()}
        onLogin={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'ログイン' })).toBeNull();
  });

  it('サーバーの既定名形式だけを判定する', () => {
    expect(isDefaultDisplayName('ゲスト000001')).toBe(true);
    expect(isDefaultDisplayName('ゲスト00000C')).toBe(true);
    expect(isDefaultDisplayName('ゲスト')).toBe(false);
    expect(isDefaultDisplayName('ゲストたろう')).toBe(false);
  });
});
