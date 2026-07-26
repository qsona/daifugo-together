import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { App } from './App';
import { useScreenStore } from './store/screen';

const KEY_VISUAL_NAME = /毎日どこかで、新ルール。/;

describe('DS-01: 開始画面でキービジュアルに迎えられる', () => {
  beforeEach(() => {
    useScreenStore.setState({ current: 'title' });
  });

  afterEach(() => {
    cleanup();
  });

  it('起動時にタイトル画面のキービジュアルが表示される', () => {
    render(<App />);

    const visual = screen.getByRole('img', { name: KEY_VISUAL_NAME });
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

    expect(screen.getByRole('button', { name: 'あそぶ' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: KEY_VISUAL_NAME })).toBeNull();
  });

  it('キーボード(Tab → Enter)でもメニュー画面へ進む', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: /はじめる/ }),
    );

    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'あそぶ' })).toBeTruthy();
  });

  it('キーボード(Space)でもメニュー画面へ進む', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.tab();
    await user.keyboard('[Space]');

    expect(screen.getByRole('button', { name: 'あそぶ' })).toBeTruthy();
  });

  it('タイトル画面にメニュー項目を置かない(メニューは 1b に分離)', () => {
    render(<App />);

    expect(screen.queryByRole('button', { name: 'あそぶ' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'ルールをていあんする' }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'ルール図鑑' })).toBeNull();
  });
});

describe('DS-02: フェーズ 1 の主要画面が 1 本の導線でつながる', () => {
  beforeEach(() => {
    useScreenStore.setState({ current: 'title' });
  });

  afterEach(() => {
    cleanup();
  });

  it('タイトル → メニュー → ルーム作成 → 待機 → 対局 → ゲーム間リザルト → セットリザルト と進める', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /はじめる/ }));
    await user.click(screen.getByRole('button', { name: 'あそぶ' }));

    // 画面 2a: 4 人固定なので人数選択 UI は置かない。
    expect(screen.getByRole('radio', { name: 'ルームをつくる' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'ルームをつくる' }));

    // 画面 2b: 招待コードと有効ルール件数。
    expect(screen.getByText('ABCD-1234')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '開始する' }));

    // 画面 3: 場・手札・ルール発動。
    expect(screen.getByRole('region', { name: '場' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'あなたの手札' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'パス' }));

    // 画面 5a: 順位のみの簡易リザルト。評価入力は置かない。
    expect(screen.getByRole('button', { name: '第2戦へ' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /高評価/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: '第2戦へ' }));

    // 画面 5b: セット単位の評価。
    expect(
      screen.getByRole('radiogroup', { name: 'このセットはおもしろかった?' }),
    ).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '高評価' })).toHaveLength(3);
  });

  it('対局画面で手札を選ぶと「出す」が押せるようになる', async () => {
    const user = userEvent.setup();
    useScreenStore.setState({ current: 'game' });
    render(<App />);

    const play = screen.getByRole('button', {
      name: 'えらんだカードを出す',
    });
    expect(play.hasAttribute('disabled')).toBe(true);

    await user.click(screen.getByRole('button', { name: 'クラブの3' }));

    expect(play.hasAttribute('disabled')).toBe(false);
  });

  it('セットリザルトの高評価は「済み」表記に変わる(色だけに頼らない)', async () => {
    const user = userEvent.setup();
    useScreenStore.setState({ current: 'setResult' });
    render(<App />);

    const [first] = screen.getAllByRole('button', { name: '高評価' });
    await user.click(first!);

    expect(screen.getAllByRole('button', { name: '高評価済み' })).toHaveLength(
      1,
    );
  });
});
