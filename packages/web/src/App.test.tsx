import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PlayerRoomView } from '@daifugo/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App, reconcileSelectedCardIds } from './App';
import { AuthApiError } from './auth/client';
import buttonStyles from './components/Button.module.css';
import type { MultiplayerClient, MultiplayerState } from './multiplayer/client';
import type { PushClient } from './push/client';
import { useScreenStore } from './store/screen';
import { GRADUATION_STORAGE_KEY } from './tutorial/graduation';
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
      screen.queryByRole('button', { name: 'ルールを提案する' }),
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

    // 「あそぶ」はまず だれとあそぶか を聞き、みんなのルールなら部屋を立てる。
    expect(
      screen.getByRole('dialog', {
        name: 'あそびかたをえらぶ',
      }),
    ).toBeTruthy();
    await user.click(
      screen.getByRole('button', { name: 'みんなのルールであそぶ' }),
    );
    await user.click(screen.getByRole('button', { name: '部屋を立てる' }));

    // 画面 2b: 招待コードと有効ルール件数。
    expect(screen.getByText('01234')).toBeTruthy();
    expect(screen.getByRole('button', { name: /有効ルール/ })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'はじめる' }));

    // 画面 3: 卓・手札・ルール発動。
    expect(screen.getByRole('region', { name: '卓' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'あなたの手札' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'パス' }));

    // 画面 5a: 順位のみの簡易リザルト。評価入力は置かない。
    expect(screen.getByRole('button', { name: 'セット結果へ' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /高評価/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'セット結果へ' }));

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
        /低評価が集まったルールは引退します/,
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

  it('セットの総合であることを見出しではなく 1 位の扱いが語る', () => {
    useScreenStore.setState({ current: 'setResult' });
    render(<App />);

    expect(screen.queryByRole('heading', { name: /総合結果/ })).toBeNull();
    // 各戦の内訳は最終戦リザルトが見せたので、ここには持ち込まない。
    expect(screen.queryByText(/→/)).toBeNull();
    expect(screen.getByText('大富豪')).toBeTruthy();
  });

  it('セットリザルトは合計点を、ゲーム間リザルトは今回の点と累計を出す', async () => {
    useScreenStore.setState({ current: 'setResult' });
    const { unmount } = render(<App />);

    // 5b: 3 戦の合計点(5-3-2-1 の積み上げ)。
    expect(screen.getByText('13点')).toBeTruthy();
    expect(screen.getByText('3点')).toBeTruthy();
    unmount();

    useScreenStore.setState({ current: 'gameResult' });
    render(<App />);

    // 5a: この戦の加点と、そこへ数え上がるセット累計。
    expect(screen.getByText('+5')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText('13点')).toBeTruthy();
    });
  });

  it('ゲーム間リザルトは待っていても次へ進む(文で予告しない)', () => {
    vi.useFakeTimers();
    try {
      useScreenStore.setState({ current: 'gameResult' });
      render(<App />);

      expect(screen.getByRole('button', { name: 'セット結果へ' })).toBeTruthy();
      expect(screen.queryByText(/自動で進む/)).toBeNull();

      act(() => {
        vi.advanceTimersByTime(9_999);
      });
      expect(screen.getByRole('button', { name: 'セット結果へ' })).toBeTruthy();

      act(() => {
        vi.advanceTimersByTime(1);
      });

      expect(screen.queryByRole('button', { name: 'セット結果へ' })).toBeNull();
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
    expect(await screen.findByText('8切り')).toBeTruthy();
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

    expect(await screen.findByText('革命返し')).toBeTruthy();
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

describe('画面のURLとリロード復帰', () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
    useScreenStore.setState({ current: 'title' });
  });

  it('通常画面の遷移にURLを割り当てる', async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', '/');
    useScreenStore.setState({ current: 'title' });
    render(<App />);

    await user.click(screen.getByRole('button', { name: /はじめる/ }));
    expect(window.location.pathname).toBe('/menu');

    await user.click(screen.getByRole('button', { name: 'ルールを提案する' }));
    expect(window.location.pathname).toBe('/proposals/new');
  });

  it('招待リンクを開いた匿名ユーザーが名前を確認して部屋へ参加できる', async () => {
    window.history.replaceState({}, '', '/?room=01234');
    const waitingRoom = {
      ...tutorialHintRoom('community', []),
      phase: 'waiting',
      game: null,
    } satisfies PlayerRoomView;
    let state: MultiplayerState = {
      connection: 'ready',
      registered: false,
      displayName: 'ゲスト',
      room: null,
      roomClosedReason: null,
      error: null,
    };
    const listeners = new Set<() => void>();
    const joinRoom = vi.fn(async (inviteCode: string) => {
      expect(inviteCode).toBe('01234');
      state = { ...state, room: waitingRoom };
      for (const listener of listeners) listener();
    });
    const client = {
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      snapshot: () => state,
      joinRoom,
    } as unknown as MultiplayerClient;

    render(<App client={client} />);

    expect(
      await screen.findByRole('dialog', { name: '友だちの部屋にはいる' }),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText('招待コード') as HTMLInputElement).value,
    ).toBe('01234');
    expect((screen.getByLabelText('なまえ') as HTMLInputElement).value).toBe(
      'ゲスト',
    );

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'はいる' }));

    await waitFor(() => expect(joinRoom).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: '待機中' })).toBeTruthy(),
    );
    expect(window.location.pathname).toBe('/rooms/tutorial-room/waiting');
    expect(window.location.search).toBe('');
  });

  it('接続確定前の対局URLではタイトルへ戻さず復帰中と表示する', () => {
    window.history.replaceState({}, '', '/rooms/room-1/game');
    const connectingState: MultiplayerState = {
      connection: 'connecting',
      registered: false,
      displayName: null,
      room: null,
      roomClosedReason: null,
      error: null,
    };
    const client = {
      subscribe: () => () => undefined,
      snapshot: () => connectingState,
    } as unknown as MultiplayerClient;

    render(<App client={client} />);

    expect(
      screen.getByRole('heading', { name: '対局に戻っています' }),
    ).toBeTruthy();
    expect(screen.queryByRole('img', { name: KEY_VISUAL_NAME })).toBeNull();
  });

  it('再接続スナップショットから対局画面とURLを復元する', () => {
    window.history.replaceState({}, '', '/rooms/tutorial-room/game');
    render(
      <App client={tutorialHintClient(tutorialHintRoom('community', []))} />,
    );

    expect(screen.getByRole('region', { name: '卓' })).toBeTruthy();
    expect(window.location.pathname).toBe('/rooms/tutorial-room/game');
  });

  it('部屋内のルール画面もURLから復元する', () => {
    window.history.replaceState({}, '', '/rooms/tutorial-room/rules');
    render(
      <App
        client={tutorialHintClient({
          ...tutorialHintRoom('community', []),
          activeRules: [{ ruleId: 'r1', name: '8切り' }],
        })}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'この対局のルール' }),
    ).toBeTruthy();
    expect(window.location.pathname).toBe('/rooms/tutorial-room/rules');
  });

  it.each(['/rooms/tutorial-room/rules', '/rooms/tutorial-room/rules/r1'])(
    '履歴戻りで %s のモーダルを閉じ、対局画面を残す',
    (path) => {
      window.history.replaceState({}, '', path);
      render(
        <App
          client={tutorialHintClient({
            ...tutorialHintRoom('community', []),
            activeRules: [{ ruleId: 'r1', name: '8切り' }],
          })}
        />,
      );
      expect(screen.getByRole('dialog')).toBeTruthy();

      act(() => {
        window.history.replaceState({}, '', '/rooms/tutorial-room/game');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });

      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getByRole('region', { name: '卓' })).toBeTruthy();
    },
  );
});

describe('ジョーカーの手札表示', () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
    useScreenStore.setState({ current: 'title' });
  });

  it('kind=jokerの札をsuitなしのJOKER札へ変換し、2枚を読み上げ名で区別する', () => {
    window.history.replaceState({}, '', '/rooms/tutorial-room/game');
    const room = tutorialHintRoom('community', null);
    render(
      <App
        client={tutorialHintClient({
          ...room,
          game: {
            ...room.game!,
            yourHand: [
              { kind: 'natural', id: 'S03', suit: 'spade', rank: '3' },
              { kind: 'joker', id: 'JK0', index: 0 },
              { kind: 'joker', id: 'JK1', index: 1 },
            ],
          },
        })}
      />,
    );

    expect(screen.getByRole('button', { name: 'スペードの3' })).toBeTruthy();
    const jokerOne = screen.getByRole('button', { name: 'ジョーカー1' });
    const jokerTwo = screen.getByRole('button', { name: 'ジョーカー2' });
    // スート記号(♠♥♦♣)を持たず JOKER 表記だけを描く。
    expect(jokerOne.textContent).toBe('JOKER');
    expect(jokerTwo.textContent).toBe('JOKER');
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
    await user.click(screen.getByRole('button', { name: 'ルールを提案する' }));

    expect(
      screen.getByRole('heading', { name: 'ルールを提案する' }),
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
      inviteCode: '01234',
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
        strengthInverted: false,
        statuses: [],
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

function tutorialHintRoom(
  mode: 'basic' | 'community',
  legalMoves: NonNullable<
    NonNullable<import('@daifugo/core').PlayerRoomView['game']>['legalMoves']
  > | null,
): import('@daifugo/core').PlayerRoomView {
  const three = {
    kind: 'natural',
    id: 'S03',
    suit: 'spade',
    rank: '3',
  } as const;
  const four = {
    kind: 'natural',
    id: 'S04',
    suit: 'spade',
    rank: '4',
  } as const;
  return {
    v: 4,
    roomId: 'tutorial-room',
    inviteCode: '01234',
    mode,
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
        handCount: 2,
        finishedRank: null,
        wantsNextSet: null,
      },
    ],
    you: { memberId: 'member-1', seatId: 0 },
    activeRules: [],
    game: {
      gameNo: 1,
      status: 'playing',
      intermission: null,
      field: { cards: [], playedBySeat: null, passedSeats: [] },
      turn: { seat: 0, turnSeq: 1, deadlineAt: null },
      history: [],
      strengthInverted: false,
      statuses: [],
      previousResults: [],
      yourHand: [three, four],
      legalMoves,
    },
    setResult: null,
    events: [],
  } satisfies import('@daifugo/core').PlayerRoomView;
}

function tutorialHintClient(
  room: import('@daifugo/core').PlayerRoomView,
): MultiplayerClient {
  const state: MultiplayerState = {
    connection: 'ready',
    registered: false,
    displayName: 'ホスト',
    room,
    roomClosedReason: null,
    error: null,
  };
  return {
    subscribe: () => () => undefined,
    snapshot: () => state,
  } as unknown as MultiplayerClient;
}

function observableTutorialClient(
  initialRoom: import('@daifugo/core').PlayerRoomView,
): {
  client: MultiplayerClient;
  setRoom(room: import('@daifugo/core').PlayerRoomView | null): void;
  readyNextGame: () => Promise<void>;
} {
  let state: MultiplayerState = {
    connection: 'ready',
    registered: false,
    displayName: 'ホスト',
    room: initialRoom,
    roomClosedReason: null,
    error: null,
  };
  const listeners = new Set<() => void>();
  const readyNextGame = vi.fn(async () => undefined);
  return {
    client: {
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      snapshot: () => state,
      readyNextGame,
    } as unknown as MultiplayerClient,
    readyNextGame,
    setRoom(room) {
      state = { ...state, room };
      for (const listener of listeners) listener();
    },
  };
}

function tutorialSetResultRoom(
  mode: 'basic' | 'community',
): import('@daifugo/core').PlayerRoomView {
  return {
    v: 12,
    roomId: `${mode}-result-room`,
    inviteCode: '01234',
    mode,
    phase: 'setResult',
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
        wantsNextSet: false,
      },
    ],
    you: { memberId: 'member-1', seatId: 0 },
    activeRules: [],
    game: null,
    setResult: {
      setId: `${mode}-result-set`,
      standings: [
        {
          memberId: 'member-1',
          totalRank: 1,
          title: '大富豪',
          ranks: [1, 1, 1],
          points: 15,
        },
      ],
      respondBy: 1_800_000_000_000,
      finalGame: null,
      firedRules: [],
    },
    events: [],
  };
}

describe('TU-02: きほんの部屋のカードヒント統合', () => {
  afterEach(cleanup);

  it('basicだけ合法手にないカードを沈め、communityでは通常表示にする', () => {
    const legalMove: import('@daifugo/core').Play = {
      kind: 'single',
      cards: [
        {
          kind: 'natural',
          id: 'S03',
          suit: 'spade',
          rank: '3',
        },
      ],
      count: 1,
      repRank: '3',
    };
    const basic = render(
      <App
        client={tutorialHintClient(tutorialHintRoom('basic', [legalMove]))}
      />,
    );
    expect(
      screen
        .getByRole('button', { name: 'スペードの4' })
        .getAttribute('aria-disabled'),
    ).toBe('true');

    basic.unmount();
    render(
      <App
        client={tutorialHintClient(tutorialHintRoom('community', [legalMove]))}
      />,
    );
    expect(
      screen
        .getByRole('button', { name: 'スペードの4' })
        .hasAttribute('aria-disabled'),
    ).toBe(false);
  });

  it('legalMovesがnullならbasicでも全カードを沈めない', () => {
    render(
      <App client={tutorialHintClient(tutorialHintRoom('basic', null))} />,
    );

    for (const card of screen.getAllByRole('button', { name: /スペードの/ })) {
      expect(card.hasAttribute('aria-disabled')).toBe(false);
    }
  });

  it('選択中カードは再タップで解除でき、dimmedカードは選択に入らない', async () => {
    const user = userEvent.setup();
    const three = {
      kind: 'natural',
      id: 'S03',
      suit: 'spade',
      rank: '3',
    } as const;
    const legalMove: import('@daifugo/core').Play = {
      kind: 'single',
      cards: [three],
      count: 1,
      repRank: '3',
    };
    render(
      <App
        client={tutorialHintClient(tutorialHintRoom('basic', [legalMove]))}
      />,
    );
    const playable = screen.getByRole('button', { name: 'スペードの3' });
    const dimmed = screen.getByRole('button', { name: 'スペードの4' });

    await user.click(playable);
    expect(playable.getAttribute('aria-pressed')).toBe('true');
    await user.click(playable);
    expect(playable.getAttribute('aria-pressed')).toBe('false');

    await user.click(dimmed);
    expect(dimmed.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('E11: ルール閲覧の実App導線', () => {
  afterEach(cleanup);

  it('メニューから図鑑を開いて戻れる', async () => {
    const user = userEvent.setup();
    useScreenStore.setState({ current: 'menu' });
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'ルール図鑑' }));
    expect(screen.getByRole('heading', { name: 'ルール図鑑' })).toBeTruthy();
    expect(
      await screen.findAllByText('対局にひとひねり加えるルールです。'),
    ).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: 'もどる' }));
    expect(screen.getByRole('button', { name: 'あそぶ' })).toBeTruthy();
  });

  it('待機画面から名称限定一覧を開いて元の画面へ戻れる', async () => {
    const user = userEvent.setup();
    useScreenStore.setState({ current: 'waitingRoom' });
    render(<App />);

    await user.click(screen.getByRole('button', { name: /有効ルール/u }));
    expect(
      screen.getByRole('heading', { name: 'この対局のルール' }),
    ).toBeTruthy();
    expect(screen.getByText('8切り')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'もどる' }));
    expect(screen.getByText('01234')).toBeTruthy();
  });

  it('接続中の対局でもsnapshotの同じactiveRulesを表示する', async () => {
    const user = userEvent.setup();
    const room = {
      ...tutorialHintRoom('community', []),
      activeRules: [
        { ruleId: 'r1', name: '8切り' },
        { ruleId: 'r2', name: '二枚縛り' },
      ],
    };
    render(<App client={tutorialHintClient(room)} />);

    await user.click(screen.getByRole('button', { name: /有効ルール/u }));
    expect(screen.getByText('8切り')).toBeTruthy();
    expect(screen.getByText('二枚縛り')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '閉じる' }));
    expect(screen.getByRole('region', { name: '卓' })).toBeTruthy();
  });

  it('一覧のルール名から盤面を残したまま詳細モーダルへ進む', async () => {
    const user = userEvent.setup();
    const room = {
      ...tutorialHintRoom('community', []),
      activeRules: [{ ruleId: 'r0001-eight-cut', name: '8切り' }],
    };
    render(<App client={tutorialHintClient(room)} />);

    await user.click(screen.getByRole('button', { name: /有効ルール/u }));
    await user.click(screen.getByRole('button', { name: '8切り' }));

    expect(screen.getByRole('dialog', { name: '8切り' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '卓' })).toBeTruthy();
  });

  it('部屋が閉じたら卓内オーバーレイを破棄する', async () => {
    const user = userEvent.setup();
    const observable = observableTutorialClient({
      ...tutorialHintRoom('community', []),
      activeRules: [{ ruleId: 'r1', name: '8切り' }],
    });
    render(<App client={observable.client} />);
    await user.click(screen.getByRole('button', { name: /有効ルール/u }));
    expect(screen.getByText('8切り')).toBeTruthy();

    act(() => observable.setRoom(null));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'あそぶ' })).toBeTruthy(),
    );
    expect(
      screen.queryByRole('heading', { name: 'この対局のルール' }),
    ).toBeNull();
  });
});

describe('ルール発動: カットインが引いてから場が流れる', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('カットイン再生中は出した札を場に残し、引いてから消す', () => {
    vi.useFakeTimers();
    const initial = {
      ...tutorialHintRoom('community', []),
      activeRules: [{ ruleId: 'r0001-eight-cut', name: '8切り' }],
    };
    const observable = observableTutorialClient(initial);
    render(<App client={observable.client} />);
    const eight = {
      kind: 'natural',
      id: 'S08',
      suit: 'spade',
      rank: '8',
    } as const;

    act(() => {
      observable.setRoom({
        ...initial,
        v: 5,
        game: {
          ...initial.game!,
          field: { cards: [], playedBySeat: null, passedSeats: [] },
          history: [
            { t: 'played', seat: 0, cards: [eight], kind: 'single' },
            {
              t: 'ruleFired',
              ruleId: 'r0001-eight-cut',
              messageKey: null,
            },
            { t: 'fieldCleared', reason: 'rule', nextLeaderSeat: 0 },
            { t: 'turnChanged', seat: 0 },
          ],
          yourHand: [],
        },
        events: [
          {
            seq: 10,
            t: 'ruleFired',
            ruleId: 'r0001-eight-cut',
            name: '8切り',
            message: null,
          },
        ],
      });
    });

    const table = within(screen.getByRole('region', { name: '卓' }));
    expect(table.getByLabelText('スペードの8')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByText('8切り')).toBeTruthy();
    expect(table.getByLabelText('スペードの8')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(750);
    });
    expect(screen.queryByText('8切り')).toBeNull();
    expect(table.getByLabelText('スペードの8')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(320);
    });
    expect(table.queryByLabelText('スペードの8')).toBeNull();
  });

  it('カットイン中に次の札が着地したら古い札の吸い込みを省略する', () => {
    vi.useFakeTimers();
    const initial = {
      ...tutorialHintRoom('community', []),
      activeRules: [{ ruleId: 'r0001-eight-cut', name: '8切り' }],
    };
    const observable = observableTutorialClient(initial);
    render(<App client={observable.client} />);
    const eight = {
      kind: 'natural',
      id: 'S08',
      suit: 'spade',
      rank: '8',
    } as const;
    const nine = {
      kind: 'natural',
      id: 'H09',
      suit: 'heart',
      rank: '9',
    } as const;
    const firedRoom: PlayerRoomView = {
      ...initial,
      v: 5,
      game: {
        ...initial.game!,
        field: { cards: [], playedBySeat: null, passedSeats: [] },
        history: [
          { t: 'played', seat: 0, cards: [eight], kind: 'single' },
          {
            t: 'ruleFired',
            ruleId: 'r0001-eight-cut',
            messageKey: null,
          },
          { t: 'fieldCleared', reason: 'rule', nextLeaderSeat: 0 },
          { t: 'turnChanged', seat: 0 },
        ],
        yourHand: [],
      },
      events: [
        {
          seq: 10,
          t: 'ruleFired',
          ruleId: 'r0001-eight-cut',
          name: '8切り',
          message: null,
        },
      ],
    };
    act(() => observable.setRoom(firedRoom));
    act(() => {
      vi.advanceTimersByTime(1050);
    });
    expect(
      within(screen.getByRole('region', { name: '卓' })).getByLabelText(
        'スペードの8',
      ),
    ).toBeTruthy();

    act(() => {
      observable.setRoom({
        ...firedRoom,
        v: 6,
        game: {
          ...firedRoom.game!,
          field: { cards: [nine], playedBySeat: 0, passedSeats: [] },
          history: [
            ...firedRoom.game!.history,
            { t: 'played', seat: 0, cards: [nine], kind: 'single' },
            { t: 'turnChanged', seat: 1 },
          ],
        },
      });
    });

    const table = within(screen.getByRole('region', { name: '卓' }));
    expect(table.queryByLabelText('スペードの8')).toBeNull();
    expect(table.getByLabelText('ハートの9')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(320);
    });
    expect(table.getByLabelText('ハートの9')).toBeTruthy();
  });
});

describe('CX-06: 実ルール発動イベントの演出', () => {
  afterEach(cleanup);

  it('新しいruleFiredを一度だけカットインし、完了後に発動の痕跡を残す', async () => {
    const user = userEvent.setup();
    const initial = {
      ...tutorialHintRoom('community', []),
      activeRules: [{ ruleId: 'r0001-revolution', name: '革命返し' }],
    };
    const observable = observableTutorialClient(initial);
    render(<App client={observable.client} />);

    act(() => {
      observable.setRoom({
        ...initial,
        v: 5,
        events: [
          {
            seq: 10,
            t: 'ruleFired',
            ruleId: 'r0001-revolution',
            name: '革命返し',
            message: '革命返しが発動!',
            messageKey: 'fired',
          },
        ],
      });
    });

    expect(await screen.findByText('革命返し')).toBeTruthy();
    expect(screen.getByText('革命返しが発動!')).toBeTruthy();
    expect(screen.getByText('NEW RULE')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '演出をとばす' }));
    expect(screen.getByRole('button', { name: '革命返し' })).toBeTruthy();

    act(() => {
      observable.setRoom({
        ...initial,
        v: 6,
        events: [
          {
            seq: 10,
            t: 'ruleFired',
            ruleId: 'r0001-revolution',
            name: '革命返し',
            message: '革命返しが発動!',
            messageKey: 'fired',
          },
        ],
      });
    });
    expect(screen.queryByRole('button', { name: '演出をとばす' })).toBeNull();
  });

  it('最終手でsetResultへ進んでも発火を次セットへ持ち越さず表示する', async () => {
    const initial = tutorialHintRoom('community', []);
    const observable = observableTutorialClient(initial);
    render(<App client={observable.client} />);

    act(() => {
      observable.setRoom({
        ...initial,
        v: 8,
        phase: 'setResult',
        game: null,
        setResult: {
          setId: 'community-result-set',
          standings: [],
          finalGame: null,
          firedRules: [{ ruleId: 'r-final', ruleName: 'あがり花火', count: 1 }],
          respondBy: Date.now() + 10_000,
        },
        events: [
          {
            seq: 30,
            t: 'ruleFired',
            ruleId: 'r-final',
            name: 'あがり花火',
            message: '最後の一手で発動!',
          },
          { seq: 31, t: 'gameEnded' },
          { seq: 32, t: 'setEnded' },
        ],
      });
    });

    expect(await screen.findByText('最後の一手で発動!')).toBeTruthy();
    expect(
      await screen.findByRole('button', { name: '演出をとばす' }),
    ).toBeTruthy();
  });

  it('非rule eventを含むseq watermarkより古い発火snapshotを再生しない', () => {
    const initial = tutorialHintRoom('community', []);
    const observable = observableTutorialClient(initial);
    render(<App client={observable.client} />);

    act(() => {
      observable.setRoom({
        ...initial,
        v: 9,
        events: [{ seq: 50, t: 'passed', seat: 1 }],
      });
    });
    act(() => {
      observable.setRoom({
        ...initial,
        v: 10,
        events: [
          {
            seq: 49,
            t: 'ruleFired',
            ruleId: 'r-stale',
            name: '古い発火',
            message: null,
          },
        ],
      });
    });

    expect(screen.queryByText('古い発火')).toBeNull();
    expect(screen.queryByRole('button', { name: '演出をとばす' })).toBeNull();
  });

  it('後続ボレーを順に再生し、別roomでも同一App sessionの既見を維持する', async () => {
    const user = userEvent.setup();
    const initial = tutorialHintRoom('community', []);
    const observable = observableTutorialClient(initial);
    render(<App client={observable.client} />);
    const fired = (seq: number, room = initial) => ({
      ...room,
      v: seq,
      events: [
        {
          seq,
          t: 'ruleFired' as const,
          ruleId: 'r-repeat',
          name: '繰り返し',
          message: null,
        },
      ],
    });

    act(() => {
      observable.setRoom(fired(60));
    });
    expect(await screen.findByText('NEW RULE')).toBeTruthy();
    act(() => {
      observable.setRoom({
        ...initial,
        v: 61,
        events: [
          {
            seq: 61,
            t: 'ruleFired',
            ruleId: 'r-later',
            name: 'あとから',
            message: null,
          },
        ],
      });
    });
    await user.click(screen.getByRole('button', { name: '演出をとばす' }));
    expect(await screen.findByText('あとから')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '演出をとばす' }));

    const anotherRoom = { ...initial, roomId: 'another-room' };
    act(() => {
      observable.setRoom(fired(1, anotherRoom));
    });
    expect(await screen.findByText('繰り返し')).toBeTruthy();
    expect(screen.queryByText('NEW RULE')).toBeNull();
  });

  it('5件同時発火でも全ルール名を表示できる', async () => {
    const initial = tutorialHintRoom('community', []);
    const observable = observableTutorialClient(initial);
    render(<App client={observable.client} />);

    act(() => {
      observable.setRoom({
        ...initial,
        v: 70,
        events: Array.from({ length: 5 }, (_, index) => ({
          seq: 70 + index,
          t: 'ruleFired' as const,
          ruleId: `r-overflow-${String(index + 1)}`,
          name: `発火${String(index + 1)}`,
          message: null,
        })),
      });
    });

    for (let index = 1; index <= 3; index += 1) {
      expect(await screen.findByText(`発火${String(index)}`)).toBeTruthy();
    }
    expect(screen.getByText(/ほか: 発火4・発火5/)).toBeTruthy();
    expect(screen.getByLabelText('5件同時発動')).toBeTruthy();
  });

  it('セット結果snapshotの発動ルールを一覧表示し、押した時点で評価を送る', async () => {
    const user = userEvent.setup();
    const initial = tutorialHintRoom('community', []);
    const update = vi.fn(async () => ({
      setRating: null,
      ruleVotes: [{ ruleId: 'r0001-revolution', vote: 'up' as const }],
    }));
    render(
      <App
        client={tutorialHintClient({
          ...initial,
          phase: 'setResult',
          game: null,
          setResult: {
            setId: 'community-result-set',
            standings: [],
            firedRules: [
              {
                ruleId: 'r0001-revolution',
                ruleName: '革命返し',
                count: 2,
              },
            ],
            finalGame: null,
            respondBy: 10_000,
          },
          events: [],
        })}
        evaluationApi={{
          get: async () => ({ setRating: null, ruleVotes: [] }),
          update,
        }}
      />,
    );

    expect(screen.getByText('発動したルール')).toBeTruthy();
    expect(screen.getByText('革命返し')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /高評価/ }));
    expect(update).toHaveBeenCalledWith('community-result-set', {
      ruleVote: { ruleId: 'r0001-revolution', vote: 'up' },
    });
  });

  it('評価の連打はクリック順に保存し、古い応答で最新表示を戻さない', async () => {
    const user = userEvent.setup();
    const initial = tutorialHintRoom('community', []);
    type EvaluationState = {
      setRating: null;
      ruleVotes: { ruleId: string; vote: 'up' | 'down' }[];
    };
    let resolveFirst!: (value: EvaluationState) => void;
    let resolveSecond!: (value: EvaluationState) => void;
    let call = 0;
    const update = vi.fn(
      () =>
        new Promise<EvaluationState>((resolve) => {
          if (call++ === 0) resolveFirst = resolve;
          else resolveSecond = resolve;
        }),
    );
    render(
      <App
        client={tutorialHintClient({
          ...initial,
          phase: 'setResult',
          game: null,
          setResult: {
            setId: 'ordered-evaluation-set',
            standings: [],
            firedRules: [
              {
                ruleId: 'r0001-revolution',
                ruleName: '革命返し',
                count: 1,
              },
            ],
            finalGame: null,
            respondBy: 10_000,
          },
          events: [],
        })}
        evaluationApi={{
          get: async () => ({ setRating: null, ruleVotes: [] }),
          update,
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: /高評価/ }));
    await user.click(screen.getByRole('button', { name: /低評価/ }));
    expect(update).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst({
        setRating: null,
        ruleVotes: [{ ruleId: 'r0001-revolution', vote: 'up' }],
      });
    });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    await act(async () => {
      resolveSecond({
        setRating: null,
        ruleVotes: [{ ruleId: 'r0001-revolution', vote: 'down' }],
      });
    });
    expect(
      screen
        .getByRole('button', { name: /低評価/ })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('遅れて届いた初期取得を失敗時の巻き戻し先に使わない', async () => {
    const user = userEvent.setup();
    const initial = tutorialHintRoom('community', []);
    let resolveGet!: (value: {
      setRating: null;
      ruleVotes: { ruleId: string; vote: 'up' | 'down' }[];
    }) => void;
    let updateCall = 0;
    const update = vi.fn(async () => {
      updateCall += 1;
      if (updateCall === 2) throw new Error('offline');
      return {
        setRating: null,
        ruleVotes: [{ ruleId: 'r0001-revolution', vote: 'up' as const }],
      };
    });
    render(
      <App
        client={tutorialHintClient({
          ...initial,
          phase: 'setResult',
          game: null,
          setResult: {
            setId: 'stale-load-evaluation-set',
            standings: [],
            firedRules: [
              {
                ruleId: 'r0001-revolution',
                ruleName: '革命返し',
                count: 1,
              },
            ],
            finalGame: null,
            respondBy: 10_000,
          },
          events: [],
        })}
        evaluationApi={{
          get: () =>
            new Promise((resolve) => {
              resolveGet = resolve;
            }),
          update,
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: /高評価/ }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    await act(async () => {
      resolveGet({ setRating: null, ruleVotes: [] });
    });
    await user.click(screen.getByRole('button', { name: /低評価/ }));
    await waitFor(() =>
      expect(
        screen.getByText('評価を送れませんでした。もう一度ためしてください。'),
      ).toBeTruthy(),
    );
    expect(
      screen
        .getByRole('button', { name: /高評価/ })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });
});

describe('TU-03: はじめての1戦のガイド', () => {
  afterEach(cleanup);

  it('未プレイのbasic 1人初戦だけ、一言と強さ目盛りを表示する', async () => {
    const three = {
      kind: 'natural',
      id: 'S03',
      suit: 'spade',
      rank: '3',
    } as const;
    const legalMove: import('@daifugo/core').Play = {
      kind: 'single',
      cards: [three],
      count: 1,
      repRank: '3',
    };
    render(
      <App
        client={tutorialHintClient(tutorialHintRoom('basic', [legalMove]))}
      />,
    );

    const guide = await screen.findByRole('status');
    expect(guide.textContent).toContain('すきなカードを 1 枚 えらんで');
    expect(guide.querySelector('ruby')).toBeNull();
    expect(
      screen.getByLabelText('カードの強さ: 左がよわい、右がつよい'),
    ).toBeTruthy();
  });

  it('ガイドは時間では消えず、表示した手番が終わると消える', () => {
    vi.useFakeTimers();
    try {
      const initial = tutorialHintRoom('basic', []);
      const observable = observableTutorialClient(initial);
      render(<App client={observable.client} />);

      expect(screen.getByRole('status')).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(screen.getByRole('status')).toBeTruthy();

      act(() => {
        observable.setRoom({
          ...initial,
          v: initial.v + 1,
          game: {
            ...initial.game!,
            turn: { seat: 1, turnSeq: 2, deadlineAt: null },
          },
        });
      });
      expect(screen.queryByRole('status')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('既プレイ端末と2戦目では、一言も強さ目盛りも表示しない', () => {
    const playedStorage = {
      getItem: () => 'true',
      setItem: () => undefined,
    };
    const first = render(
      <App
        client={tutorialHintClient(tutorialHintRoom('basic', []))}
        storage={playedStorage}
      />,
    );
    expect(screen.queryByRole('status')).toBeNull();
    expect(
      screen.queryByLabelText('カードの強さ: 左がよわい、右がつよい'),
    ).toBeNull();

    first.unmount();
    const secondGame = tutorialHintRoom('basic', []);
    secondGame.game!.gameNo = 2;
    render(<App client={tutorialHintClient(secondGame)} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(
      screen.queryByLabelText('カードの強さ: 左がよわい、右がつよい'),
    ).toBeNull();
  });

  it('未完走で退出して別の初回basic soloへ入り直すとガイドを最初から表示する', async () => {
    const firstRoom = tutorialHintRoom('basic', []);
    const observable = observableTutorialClient(firstRoom);
    render(<App client={observable.client} />);
    expect(await screen.findByRole('status')).toBeTruthy();

    act(() => observable.setRoom(null));
    expect(screen.queryByRole('status')).toBeNull();

    const nextRoom = tutorialHintRoom('basic', []);
    nextRoom.roomId = 'tutorial-room-2';
    act(() => observable.setRoom(nextRoom));

    expect(await screen.findByRole('status')).toBeTruthy();
  });

  it('初戦終了から2戦目へ進むと一言と強さ目盛りを消す', async () => {
    const firstRoom = tutorialHintRoom('basic', []);
    const observable = observableTutorialClient(firstRoom);
    render(<App client={observable.client} />);
    expect(await screen.findByRole('status')).toBeTruthy();

    const intermission = structuredClone(firstRoom);
    intermission.v += 1;
    intermission.game!.status = 'intermission';
    intermission.game!.intermission = {
      durationMs: 15_000,
      endsAt: Date.now() + 15_000,
      ready: false,
    };
    intermission.game!.turn = null;
    intermission.game!.previousResults = [
      {
        gameNo: 1,
        standings: [{ seat: 0, rank: 1, title: '大富豪', points: 5 }],
        firedRuleIds: [],
      },
    ];
    act(() => observable.setRoom(intermission));

    const secondGame = structuredClone(firstRoom);
    secondGame.v += 2;
    secondGame.game!.gameNo = 2;
    act(() => observable.setRoom(secondGame));

    expect(screen.queryByRole('status')).toBeNull();
    expect(
      screen.queryByLabelText('カードの強さ: 左がよわい、右がつよい'),
    ).toBeNull();
  });

  it('次戦ボタンを押すと準備完了を送り、押下後は待機表示で無効になる', async () => {
    const user = userEvent.setup();
    const room = tutorialHintRoom('basic', []);
    room.game!.status = 'intermission';
    room.game!.intermission = {
      durationMs: 15_000,
      endsAt: Date.now() + 15_000,
      ready: false,
    };
    room.game!.turn = null;
    const observable = observableTutorialClient(room);
    render(<App client={observable.client} />);

    await user.click(screen.getByRole('button', { name: '第2戦へ' }));
    expect(observable.readyNextGame).toHaveBeenCalledOnce();

    const waiting = structuredClone(room);
    waiting.v += 1;
    waiting.game!.intermission!.ready = true;
    act(() => observable.setRoom(waiting));

    const button = screen.getByRole('button', {
      name: 'ほかのプレイヤーを待っています',
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.classList.contains(buttonStyles.primary!)).toBe(false);
  });

  it('communityとbasic人間複数では一言も強さ目盛りも表示しない', () => {
    const community = render(
      <App client={tutorialHintClient(tutorialHintRoom('community', []))} />,
    );
    expect(screen.queryByRole('status')).toBeNull();
    expect(
      screen.queryByLabelText('カードの強さ: 左がよわい、右がつよい'),
    ).toBeNull();

    community.unmount();
    const basicMulti = tutorialHintRoom('basic', []);
    basicMulti.members.push({
      memberId: 'member-2',
      seatId: 1,
      displayName: 'ゲスト',
      isAI: false,
      isHost: false,
      connected: true,
      aiActing: false,
      departed: false,
      handCount: 2,
      finishedRank: null,
      wantsNextSet: null,
    });
    render(<App client={tutorialHintClient(basicMulti)} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(
      screen.queryByLabelText('カードの強さ: 左がよわい、右がつよい'),
    ).toBeNull();
  });
});

describe('TU-04: みんなのルールへの卒業導線', () => {
  afterEach(cleanup);

  it('basicのセットリザルトから退室後にcommunityの部屋を作る', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    const room = tutorialSetResultRoom('basic');
    const state: MultiplayerState = {
      connection: 'ready',
      registered: false,
      displayName: 'ホスト',
      room,
      roomClosedReason: null,
      error: null,
    };
    const client = {
      subscribe: () => () => undefined,
      snapshot: () => state,
      leaveRoom: vi.fn(async () => {
        calls.push('leave');
      }),
      createRoom: vi.fn(async (mode: string) => {
        calls.push(`create:${mode}`);
      }),
    } as unknown as MultiplayerClient;

    render(<App client={client} />);
    await user.click(
      screen.getByRole('button', {
        name: 'みんなのルールであそんでみる',
      }),
    );

    await waitFor(() => expect(calls).toEqual(['leave', 'create:community']));
  });

  it('セットリザルトからホームへ戻ると確認なしで退室する', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const room = tutorialSetResultRoom('community');
    const state: MultiplayerState = {
      connection: 'ready',
      registered: false,
      displayName: 'ホスト',
      room,
      roomClosedReason: null,
      error: null,
    };
    const leaveRoom = vi.fn(async () => undefined);
    const client = {
      subscribe: () => () => undefined,
      snapshot: () => state,
      leaveRoom,
    } as unknown as MultiplayerClient;

    render(<App client={client} />);
    await user.click(screen.getByRole('button', { name: 'ホームへ' }));

    await waitFor(() => expect(leaveRoom).toHaveBeenCalledOnce());
    expect(confirm).not.toHaveBeenCalled();
  });

  it('完走セットの退室後に初回の接続案内を描画してから頻度を記録する', async () => {
    const user = userEvent.setup();
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    let state: MultiplayerState = {
      connection: 'ready',
      registered: false,
      displayName: 'ホスト',
      room: tutorialSetResultRoom('community'),
      roomClosedReason: null,
      error: null,
    };
    const listeners = new Set<() => void>();
    const client = {
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      snapshot: () => state,
      leaveRoom: vi.fn(async () => {
        state = { ...state, room: null };
        for (const listener of listeners) listener();
      }),
      currentUserToken: () => 'guest-token',
    } as unknown as MultiplayerClient;

    render(<App client={client} storage={storage} />);
    expect(values.has('daifugo.authMenuPromptLastCount')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'ホームへ' }));

    expect(
      await screen.findByText(/今日の記録は、この端末だけに残っています。/u),
    ).toBeTruthy();
    await waitFor(() =>
      expect(values.get('daifugo.authMenuPromptLastCount')).toBe('1'),
    );
    await user.click(screen.getByRole('button', { name: 'Googleでつなぐ' }));
    expect(
      screen.getByRole('dialog', { name: 'Googleでつなぎますか?' }),
    ).toBeTruthy();
  });

  it('communityのセットリザルトには卒業導線を出さない', () => {
    const room = tutorialSetResultRoom('community');
    const state: MultiplayerState = {
      connection: 'ready',
      registered: false,
      displayName: 'ホスト',
      room,
      roomClosedReason: null,
      error: null,
    };
    const client = {
      subscribe: () => () => undefined,
      snapshot: () => state,
    } as unknown as MultiplayerClient;

    render(<App client={client} />);

    expect(
      screen.queryByRole('button', {
        name: 'みんなのルールであそんでみる',
      }),
    ).toBeNull();
  });

  it('保存した初回setResultだけ卒業を強調し、同じroomの次セットと既プレイ端末では通常へ戻す', async () => {
    const stored = new Map<string, string>([
      [PLAYED_BEFORE_STORAGE_KEY, 'true'],
      [
        GRADUATION_STORAGE_KEY,
        JSON.stringify({
          kind: 'emphasized',
          snapshotKey: 'basic-result-room:1800000000000',
        }),
      ],
    ]);
    const storage = {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    };
    const room = tutorialSetResultRoom('basic');
    const state: MultiplayerState = {
      connection: 'ready',
      registered: false,
      displayName: 'ホスト',
      room,
      roomClosedReason: null,
      error: null,
    };
    const client = {
      subscribe: () => () => undefined,
      snapshot: () => state,
    } as unknown as MultiplayerClient;
    const first = render(<App client={client} storage={storage} />);

    expect(
      screen
        .getByRole('button', {
          name: 'みんなのルールであそんでみる',
        })
        .classList.contains(buttonStyles.primary!),
    ).toBe(true);
    expect(
      screen
        .getByRole('button', { name: 'もう1セットあそぶ' })
        .classList.contains(buttonStyles.primary!),
    ).toBe(false);

    first.unmount();
    room.v = 24;
    render(<App client={client} storage={storage} />);
    expect(
      screen
        .getByRole('button', {
          name: 'みんなのルールであそんでみる',
        })
        .classList.contains(buttonStyles.primary!),
    ).toBe(true);

    cleanup();
    room.setResult!.respondBy = 1_800_000_120_000;
    render(<App client={client} storage={storage} />);
    expect(
      screen
        .getByRole('button', {
          name: 'みんなのルールであそんでみる',
        })
        .classList.contains(buttonStyles.primary!),
    ).toBe(false);
    expect(
      screen
        .getByRole('button', { name: 'もう1セットあそぶ' })
        .classList.contains(buttonStyles.primary!),
    ).toBe(true);

    cleanup();
    stored.delete(GRADUATION_STORAGE_KEY);
    render(<App client={client} storage={storage} />);
    expect(
      screen
        .getByRole('button', {
          name: 'みんなのルールであそんでみる',
        })
        .classList.contains(buttonStyles.primary!),
    ).toBe(false);
  });

  it('候補roomを保存した端末がsetResultへ直接復帰しても初回強調を復元する', async () => {
    const stored = new Map<string, string>([
      [PLAYED_BEFORE_STORAGE_KEY, 'true'],
      [
        GRADUATION_STORAGE_KEY,
        JSON.stringify({ kind: 'candidate', roomId: 'basic-result-room' }),
      ],
    ]);
    const storage = {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    };
    const room = tutorialSetResultRoom('basic');
    const state: MultiplayerState = {
      connection: 'ready',
      registered: false,
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

    await waitFor(() =>
      expect(
        screen
          .getByRole('button', {
            name: 'みんなのルールであそんでみる',
          })
          .classList.contains(buttonStyles.primary!),
      ).toBe(true),
    );
    expect(JSON.parse(stored.get(GRADUATION_STORAGE_KEY)!)).toEqual({
      kind: 'emphasized',
      snapshotKey: 'basic-result-room:1800000000000',
    });
  });

  it('退室に失敗したらcommunityを作らず、結果画面で再試行できる', async () => {
    const user = userEvent.setup();
    const room = tutorialSetResultRoom('basic');
    const state: MultiplayerState = {
      connection: 'ready',
      registered: false,
      displayName: 'ホスト',
      room,
      roomClosedReason: null,
      error: null,
    };
    const leaveRoom = vi.fn(async () => {
      throw new Error('leave failed');
    });
    const createRoom = vi.fn();
    const client = {
      subscribe: () => () => undefined,
      snapshot: () => state,
      leaveRoom,
      createRoom,
    } as unknown as MultiplayerClient;
    render(<App client={client} />);

    await user.click(
      screen.getByRole('button', {
        name: 'みんなのルールであそんでみる',
      }),
    );

    expect((await screen.findByRole('alert')).textContent).toContain(
      'もう一度ためしてください',
    );
    expect(leaveRoom).toHaveBeenCalledOnce();
    expect(createRoom).not.toHaveBeenCalled();
    expect(
      screen
        .getByRole('button', {
          name: 'みんなのルールであそんでみる',
        })
        .hasAttribute('disabled'),
    ).toBe(false);
  });

  it('作成だけ失敗したらcommunity作成を選択済みで再試行する', async () => {
    const user = userEvent.setup();
    let state: MultiplayerState = {
      connection: 'ready',
      registered: false,
      displayName: 'ホスト',
      room: tutorialSetResultRoom('basic'),
      roomClosedReason: null,
      error: null,
    };
    const listeners = new Set<() => void>();
    const leaveRoom = vi.fn(async () => {
      state = { ...state, room: null };
      for (const listener of listeners) listener();
    });
    let firstCreate = true;
    const createRoom = vi.fn(async () => {
      if (firstCreate) {
        firstCreate = false;
        throw new Error('create failed');
      }
    });
    const client = {
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      snapshot: () => state,
      leaveRoom,
      createRoom,
    } as unknown as MultiplayerClient;
    render(<App client={client} />);

    await user.click(
      screen.getByRole('button', {
        name: 'みんなのルールであそんでみる',
      }),
    );

    // 再試行はみんなのルールの2段目から始め、もう一度モードを選ばせない。
    expect(
      await screen.findByRole('dialog', {
        name: 'みんなのルールであそぶ',
      }),
    ).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain(
      'もう一度ためしてください',
    );
    expect(leaveRoom).toHaveBeenCalledOnce();
    expect(createRoom).toHaveBeenNthCalledWith(1, 'community');

    await user.click(screen.getByRole('button', { name: '部屋を立てる' }));
    await waitFor(() => expect(createRoom).toHaveBeenCalledTimes(2));
    expect(createRoom).toHaveBeenNthCalledWith(2, 'community');
    expect(leaveRoom).toHaveBeenCalledOnce();
  });

  it('卒業処理中の連打と次セット・ホームの競合を止める', async () => {
    const user = userEvent.setup();
    const room = tutorialSetResultRoom('basic');
    const state: MultiplayerState = {
      connection: 'ready',
      registered: false,
      displayName: 'ホスト',
      room,
      roomClosedReason: null,
      error: null,
    };
    let resolveLeave!: () => void;
    const leaveRoom = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveLeave = resolve;
        }),
    );
    const createRoom = vi.fn(async () => undefined);
    const continueRoom = vi.fn(async () => undefined);
    const client = {
      subscribe: () => () => undefined,
      snapshot: () => state,
      leaveRoom,
      createRoom,
      continueRoom,
    } as unknown as MultiplayerClient;
    render(<App client={client} />);

    const graduation = screen.getByRole('button', {
      name: 'みんなのルールであそんでみる',
    });
    await user.click(graduation);
    await user.click(graduation);
    await user.click(screen.getByRole('button', { name: 'もう1セットあそぶ' }));
    await user.click(screen.getByRole('button', { name: 'ホームへ' }));

    expect(leaveRoom).toHaveBeenCalledOnce();
    expect(continueRoom).not.toHaveBeenCalled();
    expect(createRoom).not.toHaveBeenCalled();
    for (const name of [
      'もう1セットあそぶ',
      'みんなのルールであそんでみる',
      'ホームへ',
    ]) {
      expect(
        screen.getByRole('button', { name }).hasAttribute('disabled'),
      ).toBe(true);
    }

    await act(async () => resolveLeave());
    await waitFor(() => expect(createRoom).toHaveBeenCalledWith('community'));
  });
});

describe('TU-05: ひとりで練習する部屋は待機室を挟まない', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/menu');
    useScreenStore.setState({ current: 'menu' });
  });
  afterEach(cleanup);

  const soloWaitingRoom = {
    ...tutorialHintRoom('basic', null),
    phase: 'waiting',
    game: null,
  } satisfies PlayerRoomView;

  /** 部屋作成で待機、開始で対局へ進む client。開始の成否を差し替えられる。 */
  const soloClient = (startRoom: () => Promise<void>) => {
    let state: MultiplayerState = {
      connection: 'ready',
      registered: false,
      displayName: 'ホスト',
      room: null,
      roomClosedReason: null,
      error: null,
    };
    const listeners = new Set<() => void>();
    const notify = () => {
      for (const listener of listeners) listener();
    };
    const createRoom = vi.fn(async () => {
      state = { ...state, room: soloWaitingRoom };
      notify();
    });
    const client = {
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      snapshot: () => state,
      createRoom,
      startRoom: vi.fn(async () => {
        await startRoom();
        state = { ...state, room: tutorialHintRoom('basic', null) };
        notify();
      }),
    } as unknown as MultiplayerClient;
    return { client, createRoom, startRoom: client.startRoom };
  };

  it('部屋を作ったらそのまま対局を始める', async () => {
    const user = userEvent.setup();
    const { client, createRoom, startRoom } = soloClient(async () => undefined);
    render(<App client={client} />);

    await user.click(screen.getByRole('button', { name: 'あそぶ' }));
    await user.click(
      screen.getByRole('button', { name: 'きほんルールで練習する' }),
    );

    await waitFor(() => expect(createRoom).toHaveBeenCalledWith('basic'));
    await waitFor(() => expect(startRoom).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.getByRole('region', { name: '卓' })).toBeTruthy(),
    );
    expect(screen.queryByRole('heading', { name: '待機中' })).toBeNull();
  });

  it('開始に失敗したら待機室に落ち、招待コードは出さない', async () => {
    const user = userEvent.setup();
    const { client, startRoom } = soloClient(() =>
      Promise.reject(new Error('start failed')),
    );
    render(<App client={client} />);

    await user.click(screen.getByRole('button', { name: 'あそぶ' }));
    await user.click(
      screen.getByRole('button', { name: 'きほんルールで練習する' }),
    );

    await waitFor(() => expect(startRoom).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: '待機中' })).toBeTruthy(),
    );
    expect(screen.queryByText('01234')).toBeNull();
    expect(screen.queryByRole('button', { name: /招待/ })).toBeNull();
  });

  it('招待コードでひとりで練習する部屋に入ろうとしたら理由を伝える', async () => {
    window.history.replaceState({}, '', '/?room=01234');
    let state: MultiplayerState = {
      connection: 'ready',
      registered: true,
      displayName: 'ホスト',
      room: null,
      roomClosedReason: null,
      error: null,
    };
    const listeners = new Set<() => void>();
    const joinRoom = vi.fn(() => {
      state = { ...state, error: 'ROOM_SOLO_ONLY' };
      for (const listener of listeners) listener();
      return Promise.reject(new Error('ROOM_SOLO_ONLY'));
    });
    const client = {
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      snapshot: () => state,
      joinRoom,
    } as unknown as MultiplayerClient;
    render(<App client={client} />);

    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'はいる' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'この部屋はひとりで練習する部屋です。友だちの部屋の招待コードをたしかめてください。',
    );
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
      inviteCode: '01234',
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
        intermission: {
          durationMs: 15_000,
          endsAt: Date.now() + 15_000,
          ready: false,
        },
        field: { cards: [], playedBySeat: null, passedSeats: [] },
        turn: null,
        history: [],
        strengthInverted: false,
        statuses: [],
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
      registered: false,
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

function finalGameRoom(
  finalGame: NonNullable<
    import('@daifugo/core').PlayerRoomView['setResult']
  >['finalGame'],
): import('@daifugo/core').PlayerRoomView {
  return {
    v: 20,
    roomId: 'final-room',
    inviteCode: '01234',
    mode: 'community',
    phase: 'setResult',
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
        wantsNextSet: false,
      },
      {
        memberId: 'member-2',
        seatId: 1,
        displayName: 'プレイヤーB',
        isAI: true,
        isHost: false,
        connected: true,
        aiActing: false,
        departed: false,
        handCount: 0,
        finishedRank: 2,
        wantsNextSet: true,
      },
    ],
    you: { memberId: 'member-1', seatId: 0 },
    activeRules: [],
    game: null,
    setResult: {
      setId: 'final-result-set',
      standings: [
        {
          memberId: 'member-1',
          totalRank: 1,
          title: '大富豪',
          ranks: [1, 2, 1],
          points: 13,
        },
        {
          memberId: 'member-2',
          totalRank: 2,
          title: '富豪',
          ranks: [2, 1, 2],
          points: 10,
        },
      ],
      finalGame,
      firedRules: [],
      respondBy: 1_800_000_000_000,
    },
    events: [],
  } satisfies import('@daifugo/core').PlayerRoomView;
}

const FINAL_GAME = {
  gameNo: 3,
  standings: [
    { seat: 0 as const, rank: 1 as const, title: '大富豪' as const, points: 5 },
    { seat: 1 as const, rank: 2 as const, title: '富豪' as const, points: 3 },
  ],
  firedRuleIds: [],
};

describe('セット最終戦のリザルト', () => {
  // 直前の describe が後片付けしない描画を残すので、始める前にも掃除する。
  beforeEach(cleanup);
  afterEach(cleanup);

  it('setResultに入るとまず最終戦の結果を出し、押すとセットリザルトへ進む', async () => {
    const user = userEvent.setup();
    const observable = observableTutorialClient(finalGameRoom(FINAL_GAME));
    render(<App client={observable.client} />);

    expect(screen.getByText('第3戦 おわり')).toBeTruthy();
    expect(screen.getByText('+5')).toBeTruthy();
    expect(screen.queryByText('セットリザルト')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'セット結果へ' }));

    expect(screen.getByText('セットリザルト')).toBeTruthy();
    expect(screen.getByText('13点')).toBeTruthy();
  });

  it('進んだあとの更新で最終戦の結果へ巻き戻らない', async () => {
    const user = userEvent.setup();
    const observable = observableTutorialClient(finalGameRoom(FINAL_GAME));
    render(<App client={observable.client} />);

    await user.click(screen.getByRole('button', { name: 'セット結果へ' }));
    act(() => {
      observable.setRoom({ ...finalGameRoom(FINAL_GAME), v: 21 });
    });

    expect(screen.getByText('セットリザルト')).toBeTruthy();
    expect(screen.queryByText('第3戦 おわり')).toBeNull();
  });

  it('最終戦の結果が無いセットでは直接セットリザルトを出す', () => {
    const observable = observableTutorialClient(finalGameRoom(null));
    render(<App client={observable.client} />);

    expect(screen.getByText('セットリザルト')).toBeTruthy();
    expect(screen.queryByText(/おわり/)).toBeNull();
  });
});

describe('対局終了時の最後の手', () => {
  beforeEach(cleanup);
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('最後の人が出した札を結果画面の前に短時間見せる', () => {
    vi.useFakeTimers();
    const room = tutorialHintRoom('community', []);
    room.v += 1;
    room.game!.status = 'intermission';
    room.game!.intermission = {
      durationMs: 15_000,
      endsAt: Date.now() + 15_000,
      ready: false,
    };
    room.game!.turn = null;
    room.game!.history = [
      {
        t: 'played',
        seat: 0,
        cards: [{ kind: 'natural', id: 'S08', suit: 'spade', rank: '8' }],
        kind: 'single',
      },
      { t: 'playerFinished', seat: 0, rank: 1, title: '大富豪' },
      {
        t: 'gameEnded',
        standings: [{ seat: 0, rank: 1, title: '大富豪' }],
      },
    ];
    const observable = observableTutorialClient(room);

    render(<App client={observable.client} />);

    expect(
      screen.getByRole('dialog', { name: 'あなたがあがり!' }),
    ).toBeTruthy();
    expect(screen.getByRole('img', { name: 'スペードの8' })).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1_799);
    });
    expect(
      screen.getByRole('dialog', { name: 'あなたがあがり!' }),
    ).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(
      screen.queryByRole('dialog', { name: 'あなたがあがり!' }),
    ).toBeNull();
    expect(screen.getByRole('button', { name: '第2戦へ' })).toBeTruthy();
  });
});

describe('AU-01: 認証完了のアプリ統合', () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState(null, '', '/');
  });

  function authClient(state: MultiplayerState) {
    return {
      subscribe: () => () => undefined,
      snapshot: () => state,
      currentUserToken: () => 'live-socket-token',
      switchSession: vi.fn(),
      setUnreadNotificationCount: vi.fn(),
    } as unknown as MultiplayerClient;
  }

  function authPush(continueAfterLogin = false) {
    return {
      reportInstalled: vi.fn(async () => undefined),
      consumeOfferAfterLogin: vi.fn(() => continueAfterLogin),
      offer: vi.fn(async () => 'push' as const),
      subscribeProposalResults: vi.fn(async () => 'subscribed' as const),
      declineOffer: vi.fn(),
      disableThisDevice: vi.fn(async () => undefined),
      hasActiveSubscription: vi.fn(async () => false),
      offerDeclined: vi.fn(() => false),
      markOfferAfterLogin: vi.fn(),
    } as unknown as PushClient;
  }

  it('ottをAPIで引き換え、linkedをルート直下のトーストで伝える', async () => {
    useScreenStore.setState({ current: 'title' });
    window.history.replaceState(null, '', '/#/auth/complete?ott=one-time');
    const state: MultiplayerState = {
      connection: 'ready',
      registered: false,
      displayName: 'ゲスト000001',
      room: null,
      roomClosedReason: null,
      error: null,
    };
    const client = authClient(state);
    const auth = {
      begin: vi.fn(async () => undefined),
      complete: vi.fn(async () => ({
        outcome: 'linked' as const,
        userToken: 'registered-token',
        displayName: 'たろう',
      })),
    };

    render(<App client={client} auth={auth} push={authPush()} />);

    await waitFor(() => expect(auth.complete).toHaveBeenCalledWith('one-time'));
    expect(client.switchSession).toHaveBeenCalledWith('registered-token');
    expect((await screen.findByRole('status')).textContent).toBe(
      'Googleでつなぎました',
    );
    expect(window.location.hash).toBe('');
  });

  it('期限切れでは再試行ダイアログを出し、DLG-1を開き直す', async () => {
    useScreenStore.setState({ current: 'title' });
    window.history.replaceState(null, '', '/#/auth/complete?error=expired');
    const state: MultiplayerState = {
      connection: 'ready',
      registered: false,
      displayName: 'ゲスト000001',
      room: null,
      roomClosedReason: null,
      error: null,
    };
    const user = userEvent.setup();
    render(
      <App
        client={authClient(state)}
        auth={{
          begin: vi.fn(async () => undefined),
          complete: vi.fn(async () => {
            throw new Error('unused');
          }),
        }}
        push={authPush()}
      />,
    );

    expect(
      await screen.findByRole('dialog', { name: '途中で時間がすぎました' }),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'もう一度ためす' }));
    expect(
      screen.getByRole('dialog', { name: 'Googleでつなぎますか?' }),
    ).toBeTruthy();
  });

  it('メニューのアカウント行からDLG-1を経て現在のsocket tokenで始める', async () => {
    useScreenStore.setState({ current: 'menu' });
    window.history.replaceState(null, '', '/menu');
    const state: MultiplayerState = {
      connection: 'ready',
      registered: false,
      displayName: 'ゲスト000001',
      room: null,
      roomClosedReason: null,
      error: null,
    };
    const auth = {
      begin: vi.fn(async () => undefined),
      complete: vi.fn(async () => {
        throw new Error('unused');
      }),
    };
    const user = userEvent.setup();
    render(<App client={authClient(state)} auth={auth} push={authPush()} />);

    await user.click(screen.getByRole('button', { name: /記録を開く/ }));
    await user.click(screen.getByRole('button', { name: 'Googleでつなぐ' }));
    expect(
      screen.getByRole('dialog', { name: 'Googleでつなぎますか?' }),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Googleへ進む' }));
    await waitFor(() =>
      expect(auth.begin).toHaveBeenCalledWith('live-socket-token'),
    );
  });

  it('503では再試行させずアプリ内の失敗ダイアログに留める', async () => {
    useScreenStore.setState({ current: 'menu' });
    const state: MultiplayerState = {
      connection: 'ready',
      registered: false,
      displayName: 'ゲスト000001',
      room: null,
      roomClosedReason: null,
      error: null,
    };
    const user = userEvent.setup();
    render(
      <App
        client={authClient(state)}
        auth={{
          begin: vi.fn(async () => {
            throw new AuthApiError(503);
          }),
          complete: vi.fn(),
        }}
        push={authPush()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /記録を開く/ }));
    await user.click(screen.getByRole('button', { name: 'Googleでつなぐ' }));
    await user.click(screen.getByRole('button', { name: 'Googleへ進む' }));
    expect(
      await screen.findByRole('dialog', { name: '今はつなげません' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'もう一度ためす' })).toBeNull();
  });

  it('switchedは開始前の未登録状態に合う説明をダイアログで伝える', async () => {
    useScreenStore.setState({ current: 'menu' });
    window.sessionStorage.setItem('daifugo.authStartedRegistered', 'false');
    window.history.replaceState(null, '', '/#/auth/complete?ott=switched-ott');
    const state: MultiplayerState = {
      connection: 'ready',
      registered: false,
      displayName: 'ゲスト000001',
      room: null,
      roomClosedReason: null,
      error: null,
    };

    render(
      <App
        client={authClient(state)}
        auth={{
          begin: vi.fn(),
          complete: vi.fn(async () => ({
            outcome: 'switched' as const,
            userToken: 'old-account-token',
            displayName: 'たろう',
          })),
        }}
        push={authPush()}
      />,
    );

    const dialog = await screen.findByRole('dialog', {
      name: 'おかえりなさい、たろうさん',
    });
    // 匿名からの切替では、前の記録に関する損失通知を出さない
    expect(within(dialog).queryByText(/もう見られません/u)).toBeNull();
  });

  it('サインアウトは確認後に購読解除してから匿名セッションへ切り替える', async () => {
    useScreenStore.setState({ current: 'menu' });
    const state: MultiplayerState = {
      connection: 'ready',
      registered: true,
      displayName: 'たろう',
      room: null,
      roomClosedReason: null,
      error: null,
    };
    const order: string[] = [];
    const client = authClient(state);
    client.switchSession = vi.fn(() => {
      order.push('session');
    });
    const push = {
      ...authPush(),
      hasActiveSubscription: vi.fn(async () => true),
      disableThisDevice: vi.fn(async () => {
        order.push('push');
      }),
    } as unknown as PushClient;
    const user = userEvent.setup();
    render(<App client={client} push={push} />);

    await user.click(screen.getByRole('button', { name: /記録を開く/ }));
    await user.click(screen.getByRole('button', { name: 'サインアウト' }));
    const dialog = screen.getByRole('dialog', {
      name: 'サインアウトしますか?',
    });
    expect(client.switchSession).not.toHaveBeenCalled();
    expect(
      await within(dialog).findByText('この端末のおしらせも届かなくなります。'),
    ).toBeTruthy();
    await user.click(
      within(dialog).getByRole('button', { name: 'サインアウトする' }),
    );

    await waitFor(() => expect(order).toEqual(['push', 'session']));
    expect((await screen.findByRole('status')).textContent).toBe(
      'サインアウトしました',
    );
  });
});

describe('対局を途中でやめる', () => {
  afterEach(() => {
    cleanup();
  });

  function quitClient(mode: 'basic' | 'community'): {
    client: MultiplayerClient;
    leaveRoom: ReturnType<typeof vi.fn>;
  } {
    const state: MultiplayerState = {
      connection: 'ready',
      registered: false,
      displayName: 'ホスト',
      room: tutorialHintRoom(mode, []),
      roomClosedReason: null,
      error: null,
    };
    const leaveRoom = vi.fn(async () => undefined);
    return {
      client: {
        subscribe: () => () => undefined,
        snapshot: () => state,
        leaveRoom,
      } as unknown as MultiplayerClient,
      leaveRoom,
    };
  }

  it('対局中の「やめる」は確認を挟み、承認して初めて退室する', async () => {
    const user = userEvent.setup();
    const { client, leaveRoom } = quitClient('community');

    render(<App client={client} />);
    await user.click(screen.getByRole('button', { name: 'やめる' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('対局をやめますか?')).toBeTruthy();
    expect(leaveRoom).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'やめる' }));
    await waitFor(() => expect(leaveRoom).toHaveBeenCalledOnce());
  });

  it('確認で「もどる」を押すと退室せず対局に戻る', async () => {
    const user = userEvent.setup();
    const { client, leaveRoom } = quitClient('community');

    render(<App client={client} />);
    await user.click(screen.getByRole('button', { name: 'やめる' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'もどる',
      }),
    );

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(leaveRoom).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'やめる' })).toBeTruthy();
  });

  it('AI代行の注記はcommunityだけに出す', async () => {
    const user = userEvent.setup();

    const community = quitClient('community');
    render(<App client={community.client} />);
    await user.click(screen.getByRole('button', { name: 'やめる' }));
    expect(
      within(screen.getByRole('dialog')).getByText(/AIが引きつぎます/),
    ).toBeTruthy();
    cleanup();

    const basic = quitClient('basic');
    render(<App client={basic.client} />);
    await user.click(screen.getByRole('button', { name: 'やめる' }));
    expect(
      within(screen.getByRole('dialog')).queryByText(/AIが引きつぎます/),
    ).toBeNull();
  });

  it('退室に失敗したらダイアログを閉じずに案内を出す', async () => {
    const user = userEvent.setup();
    const state: MultiplayerState = {
      connection: 'ready',
      registered: false,
      displayName: 'ホスト',
      room: tutorialHintRoom('community', []),
      roomClosedReason: null,
      error: null,
    };
    const client = {
      subscribe: () => () => undefined,
      snapshot: () => state,
      leaveRoom: vi.fn(async () => {
        throw new Error('network');
      }),
    } as unknown as MultiplayerClient;

    render(<App client={client} />);
    await user.click(screen.getByRole('button', { name: 'やめる' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'やめる',
      }),
    );

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'もう一度ためしてください',
      ),
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('待機画面の退室確認もダイアログで行う', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const room: PlayerRoomView = {
      ...tutorialHintRoom('community', []),
      phase: 'waiting',
      game: null,
    };
    const state: MultiplayerState = {
      connection: 'ready',
      registered: false,
      displayName: 'ホスト',
      room,
      roomClosedReason: null,
      error: null,
    };
    const leaveRoom = vi.fn(async () => undefined);
    const client = {
      subscribe: () => () => undefined,
      snapshot: () => state,
      leaveRoom,
    } as unknown as MultiplayerClient;

    render(<App client={client} />);
    await user.click(screen.getByRole('button', { name: 'もどる' }));

    expect(confirm).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('部屋から出ますか?')).toBeTruthy();

    await user.click(within(dialog).getByRole('button', { name: '出る' }));
    await waitFor(() => expect(leaveRoom).toHaveBeenCalledOnce());
  });
});
