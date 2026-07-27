import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App, reconcileSelectedCardIds } from './App';
import type { MultiplayerClient, MultiplayerState } from './multiplayer/client';
import { useScreenStore } from './store/screen';
import { PLAYED_BEFORE_STORAGE_KEY } from './tutorial/played-before';

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
    expect(visual.getAttribute('src')).toMatch(/key-visual-2a-outlined\.svg/);
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

    // 「あそぶ」はモードを選び、そのまま作る/入るの選択へ進む。
    expect(
      screen.getByRole('dialog', {
        name: 'あそぶモードをえらぶ',
      }),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /きほん/ }));
    expect(
      screen.getByRole('dialog', {
        name: 'じぶんの部屋をつくる',
      }),
    ).toBeTruthy();
    await user.click(
      screen.getByRole('button', { name: 'じぶんの部屋をつくる' }),
    );

    // 画面 2b: 招待コードと有効ルール件数。
    expect(screen.getByText('ABCD-1234')).toBeTruthy();
    expect(screen.getByRole('button', { name: /有効ルール/ })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '開始する' }));

    // 画面 3: 卓・手札・ルール発動。
    expect(screen.getByRole('region', { name: '卓' })).toBeTruthy();
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

  it('画面に説明文を置かない(UI文言・情報量ガイド)', () => {
    for (const id of [
      'waitingRoom',
      'game',
      'gameResult',
      'setResult',
    ] as const) {
      useScreenStore.setState({ current: id });
      const { unmount } = render(<App />);

      // 使い方・仕組み・予告の説明文はどれも画面に置かない。
      for (const prose of [
        /枠を決める操作はありません/,
        /足りない分は AI プレイヤーが入ります/,
        /変更不可/,
        /まもなく次の戦がはじまります/,
        /評価はセットの最後/,
        /よかったルールには高評価/,
        /低評価が集まったルールは排除されます/,
      ]) {
        expect(screen.queryByText(prose)).toBeNull();
      }

      unmount();
    }
  });

  it('セット評価は顔で選ばせ、文言はアクセシブル名に残す', async () => {
    const user = userEvent.setup();
    useScreenStore.setState({ current: 'setResult' });
    render(<App />);

    const fun = screen.getByRole('radio', { name: 'おもしろかった' });
    // 顔だけを出し、選択肢の文字は画面に置かない。
    expect(fun.textContent).toBe('');
    expect(fun.getAttribute('aria-checked')).toBe('false');

    await user.click(fun);
    expect(fun.getAttribute('aria-checked')).toBe('true');
  });

  it('セットの総合であることを見出しではなく順位推移が語る', () => {
    useScreenStore.setState({ current: 'setResult' });
    render(<App />);

    expect(screen.queryByRole('heading', { name: /総合結果/ })).toBeNull();
    expect(screen.getByText('1→1→2')).toBeTruthy();
    expect(screen.getByText('4→4→4')).toBeTruthy();
  });

  it('セットリザルトは合計点を、ゲーム間リザルトは今回の点と累計を出す', () => {
    useScreenStore.setState({ current: 'setResult' });
    const { unmount } = render(<App />);

    // 5b: 3 戦の合計点(5-3-2-1 の積み上げ)。
    expect(screen.getByText('13点')).toBeTruthy();
    expect(screen.getByText('3点')).toBeTruthy();
    unmount();

    useScreenStore.setState({ current: 'gameResult' });
    render(<App />);

    // 5a: 第1戦では今回点と累計が同値なので、累計だけを出す。
    expect(screen.queryByText('+5')).toBeNull();
    expect(screen.getByText('5点')).toBeTruthy();
  });

  it('ゲーム間リザルトは待っていても次戦へ進む(文で予告しない)', () => {
    vi.useFakeTimers();
    try {
      useScreenStore.setState({ current: 'gameResult' });
      render(<App />);

      expect(screen.getByRole('button', { name: '第2戦へ' })).toBeTruthy();
      expect(screen.queryByText(/自動で進む/)).toBeNull();

      act(() => {
        vi.advanceTimersByTime(14_999);
      });
      expect(screen.getByRole('button', { name: '第2戦へ' })).toBeTruthy();

      act(() => {
        vi.advanceTimersByTime(1);
      });

      expect(screen.queryByRole('button', { name: '第2戦へ' })).toBeNull();
      expect(
        screen.getByRole('radiogroup', { name: 'このセットはおもしろかった?' }),
      ).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('主 CTA は 1 ボタン 1 動作にする', () => {
    useScreenStore.setState({ current: 'setResult' });
    render(<App />);

    // 評価は押した時点で送信済みなので、CTA は次の行動だけを言う。
    expect(
      screen.getByRole('button', { name: 'もう1セットあそぶ' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /評価を送信して/ })).toBeNull();
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

  it('隣接するカードを続けて選択できる', async () => {
    const user = userEvent.setup();
    useScreenStore.setState({ current: 'game' });
    render(<App />);

    const first = screen.getByRole('button', { name: 'クラブの3' });
    const second = screen.getByRole('button', { name: 'ダイヤの4' });
    await user.click(first);
    await user.click(second);

    expect(first.getAttribute('aria-pressed')).toBe('true');
    expect(second.getAttribute('aria-pressed')).toBe('true');
  });

  it('卓は席と場が統合され、各自の札山が見える(実況ログを置かない)', () => {
    useScreenStore.setState({ current: 'game' });
    render(<App />);

    // 誰が何を出したかは札山が常時見せる。
    expect(
      screen.getByRole('list', { name: 'プレイヤーBが出した札' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('list', { name: 'プレイヤーCが出した札' }),
    ).toBeTruthy();

    // 文字の実況ログは存在しない。
    expect(screen.queryByRole('list', { name: '実況ログ' })).toBeNull();
    expect(screen.queryByText(/を出した$/)).toBeNull();
  });

  it('席の場には最新のプレイ 1 回分だけを出す(前のプレイは置き換える)', () => {
    useScreenStore.setState({ current: 'game' });
    render(<App />);

    // プレイヤーB は同じ場で 5 のペア → 9 のペアと出している。
    const pile = screen.getByRole('list', { name: 'プレイヤーBが出した札' });
    expect(pile.querySelectorAll('li')).toHaveLength(2);
    expect(screen.getByLabelText('スペードの9')).toBeTruthy();
    expect(screen.queryByLabelText('スペードの5')).toBeNull();
  });

  it('あがった席は残り枚数ではなく順位バッジを出す', () => {
    useScreenStore.setState({ current: 'game' });
    render(<App />);

    expect(screen.getByText('1位')).toBeTruthy();
    expect(screen.getByText('大富豪')).toBeTruthy();
    // 残り枚数はまだ対局に残っている席にだけ出る。
    expect(screen.getByText('6枚')).toBeTruthy();
    expect(screen.queryByText('0枚')).toBeNull();
  });

  it('席の名前は枚数や状態と分かれていて、省略されずに読める', () => {
    useScreenStore.setState({ current: 'game' });
    render(<App />);

    // 名前・枚数・状態はそれぞれ別の要素。名前の要素に枚数や状態は混ざらない。
    const table = within(screen.getByRole('region', { name: '卓' }));
    expect(table.getByText('プレイヤーC').textContent).toBe('プレイヤーC');
    expect(table.getByText('考え中…')).toBeTruthy();
    expect(table.getByText('パス')).toBeTruthy();
  });

  it('画面を開いた時点の過去のあがりは告知しない(再接続で再演出しない)', () => {
    useScreenStore.setState({ current: 'game' });
    render(<App />);

    // 見本の履歴には 1 位のあがりが入っているが、初回描画分は基準として飲む。
    expect(screen.queryByText(/であがり/)).toBeNull();
  });

  it('アプリバーに巡目を出さず、有効ルールへの導線は残す', () => {
    useScreenStore.setState({ current: 'game' });
    render(<App />);

    expect(screen.getByRole('heading', { name: '第1戦' })).toBeTruthy();
    expect(screen.queryByText(/巡目/)).toBeNull();
    expect(screen.getByRole('button', { name: /有効ルール/ })).toBeTruthy();
  });

  it('カードを出すとルール名のカットインが出る(効果の説明文は置かない)', async () => {
    const user = userEvent.setup();
    useScreenStore.setState({ current: 'game' });
    render(<App />);

    expect(screen.queryByText('8切り')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'クラブの3' }));
    await user.click(
      screen.getByRole('button', { name: 'えらんだカードを出す' }),
    );

    // 文字はルール名だけ。「ルール発動!」「場が流れます」の類は出さない。
    expect(screen.getByText('8切り')).toBeTruthy();
    expect(screen.queryByText(/ルール発動/)).toBeNull();
    expect(screen.queryByText(/場が流れます/)).toBeNull();
  });

  it('カットインは進行をブロックせず、タップでとばせる', async () => {
    const user = userEvent.setup();
    useScreenStore.setState({ current: 'game' });
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'クラブの3' }));
    await user.click(
      screen.getByRole('button', { name: 'えらんだカードを出す' }),
    );

    await user.click(screen.getByRole('button', { name: '演出をとばす' }));

    expect(screen.queryByRole('button', { name: '演出をとばす' })).toBeNull();
    // 引いたあとは発動チップが残り、あとから確認できる。
    expect(screen.getByRole('button', { name: /8切り/ })).toBeTruthy();
  });

  it('同時発動は 1 ボレーにまとめ、件数バッジで示す', async () => {
    const user = userEvent.setup();
    useScreenStore.setState({ current: 'game' });
    render(<App />);

    const play = screen.getByRole('button', { name: 'えらんだカードを出す' });
    await user.click(screen.getByRole('button', { name: 'クラブの3' }));

    // 見本は 単発 → 初登場 → 同時 3 件 の順に再生する。
    await user.click(play);
    await user.click(screen.getByRole('button', { name: '演出をとばす' }));
    await user.click(screen.getByRole('button', { name: 'ダイヤの4' }));
    await user.click(play);
    await user.click(screen.getByRole('button', { name: '演出をとばす' }));
    await user.click(screen.getByRole('button', { name: 'スペードの6' }));
    await user.click(play);

    expect(screen.getByText('革命返し')).toBeTruthy();
    expect(screen.getByText('スペ3返し')).toBeTruthy();
    expect(screen.getByLabelText('3件同時発動')).toBeTruthy();
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

describe('RP-01: メニューからルール提案へ進む', () => {
  beforeEach(() => {
    useScreenStore.setState({ current: 'title' });
  });

  afterEach(() => {
    cleanup();
  });

  it('タイトル→メニュー→画面6を一本の導線で開き、戻れる', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /はじめる/ }));
    await user.click(
      screen.getByRole('button', { name: 'ルールをていあんする' }),
    );

    expect(
      screen.getByRole('heading', { name: 'ルールをていあんする' }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole('radio', { name: 'ローカルルール' })
        .getAttribute('aria-checked'),
    ).toBe('true');

    await user.click(screen.getByRole('button', { name: 'もどる' }));
    expect(screen.getByRole('button', { name: 'あそぶ' })).toBeTruthy();
  });
});

describe('MP-04: タイムアウト代行後の選択状態', () => {
  it('自席のturnTimeoutで全選択を消し、通常更新でも手札にないIDを除く', () => {
    const base = {
      v: 2,
      roomId: 'room-1',
      inviteCode: 'ABCD-2345',
      mode: 'community',
      phase: 'playing',
      members: [],
      you: { memberId: 'member-1', seatId: 0 },
      activeRules: [],
      game: {
        gameNo: 1,
        status: 'playing',
        intermission: null,
        field: { cards: [], playedBySeat: null, passedSeats: [] },
        turn: { seat: 1, turnSeq: 3, deadlineAt: null },
        history: [],
        previousResults: [],
        yourHand: [{ kind: 'natural', id: 'S03', suit: 'spade', rank: '3' }],
        legalMoves: [],
      },
      setResult: null,
      events: [],
    } satisfies import('@daifugo/core').PlayerRoomView;

    expect(reconcileSelectedCardIds(['S03', 'missing'], base)).toEqual(['S03']);
    expect(
      reconcileSelectedCardIds(['S03', 'missing'], {
        ...base,
        v: 3,
        events: [{ seq: 8, t: 'turnTimeout', seat: 0 }],
      }),
    ).toEqual([]);
  });
});

describe('TU-01: 既プレイ端末の記録', () => {
  it('1戦完了のスナップショットを受けるとlocalStorageへ記録する', () => {
    const stored = new Map<string, string>();
    const storage = {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    };
    const room = {
      v: 4,
      roomId: 'tutorial-room',
      inviteCode: 'ABCD-2345',
      mode: 'basic',
      phase: 'playing',
      members: [
        {
          memberId: 'member-1',
          seatId: 0,
          displayName: 'ホスト',
          isAI: false,
          isHost: true,
          connected: true,
          aiActing: false,
          departed: false,
          handCount: 0,
          finishedRank: 1,
          wantsNextSet: null,
        },
      ],
      you: { memberId: 'member-1', seatId: 0 },
      activeRules: [],
      game: {
        gameNo: 1,
        status: 'intermission',
        intermission: { durationMs: 15_000, endsAt: Date.now() + 15_000 },
        field: { cards: [], playedBySeat: null, passedSeats: [] },
        turn: null,
        history: [],
        previousResults: [
          {
            gameNo: 1,
            standings: [
              {
                seat: 0,
                rank: 1,
                title: '大富豪',
                points: 5,
              },
            ],
            firedRuleIds: [],
          },
        ],
        yourHand: [],
        legalMoves: null,
      },
      setResult: null,
      events: [],
    } satisfies import('@daifugo/core').PlayerRoomView;
    const state: MultiplayerState = {
      connection: 'ready',
      displayName: 'ホスト',
      room,
      roomClosedReason: null,
      error: null,
    };
    const client = {
      subscribe: () => () => undefined,
      snapshot: () => state,
    } as unknown as MultiplayerClient;

    render(<App client={client} storage={storage} />);

    expect(stored.get(PLAYED_BEFORE_STORAGE_KEY)).toBe('true');
  });
});
