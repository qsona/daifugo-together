import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { App } from './App';
import { useScreenStore } from './store/screen';

describe('DS-01: 開始画面でキービジュアルに迎えられる', () => {
  beforeEach(() => {
    useScreenStore.setState({ current: 'title' });
  });

  afterEach(() => {
    cleanup();
  });

  it('起動時にタイトル画面のキービジュアルが表示される', () => {
    render(<App />);

    const visual = screen.getByRole('img', {
      name: /みんなでつくろう 大富豪/,
    });
    expect(visual).toBeTruthy();
    expect(visual.getAttribute('src')).toMatch(/key-visual-2a\.svg/);
  });

  it('画面全体が「はじめる」ボタンとして支援技術に露出する', () => {
    render(<App />);

    expect(
      screen.getByRole('button', { name: 'はじめる(タップして進む)' }),
    ).toBeTruthy();
  });

  it('クリックでメニュー画面(1b)へ進む', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /はじめる/ }));

    expect(screen.getByRole('heading', { name: 'メニュー' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: /大富豪/ })).toBeNull();
  });

  it('キーボード(Tab → Enter)でもメニュー画面へ進む', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: /はじめる/ }),
    );

    await user.keyboard('{Enter}');
    expect(screen.getByRole('heading', { name: 'メニュー' })).toBeTruthy();
  });

  it('キーボード(Space)でもメニュー画面へ進む', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.tab();
    await user.keyboard('[Space]');

    expect(screen.getByRole('heading', { name: 'メニュー' })).toBeTruthy();
  });

  it('タイトル画面にメニュー項目を置かない(メニューは 1b に分離)', () => {
    render(<App />);

    expect(screen.queryByText('あそぶ')).toBeNull();
    expect(screen.queryByText('ルール提案')).toBeNull();
    expect(screen.queryByText('ルール図鑑')).toBeNull();
  });
});
