import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccountRow, isDefaultDisplayName } from './AccountRow';

afterEach(cleanup);

describe('AccountRow', () => {
  it.each([
    ['anonymous', 'この端末だけ', false],
    ['registered', 'どの端末でも', false],
    ['pending', 'つなぎ中', true],
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
    expect(screen.getByText(label)).toBeTruthy();
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

  it('サーバーの既定名形式だけを判定する', () => {
    expect(isDefaultDisplayName('ゲスト000001')).toBe(true);
    expect(isDefaultDisplayName('ゲスト00000C')).toBe(true);
    expect(isDefaultDisplayName('ゲスト')).toBe(false);
    expect(isDefaultDisplayName('ゲストたろう')).toBe(false);
  });
});
