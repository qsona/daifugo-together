import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import buttonStyles from '../components/Button.module.css';
import confettiStyles from '../components/Confetti.module.css';
import { SetResultScreen } from './SetResultScreen';

afterEach(cleanup);

describe('SetResultScreen phase boundary', () => {
  it('自分の総合順位に応じたXシェアと支援導線を出す', () => {
    render(
      <SetResultScreen
        ranks={[
          {
            place: 2,
            name: 'あなた',
            kind: 'human',
            totalPoints: 10,
            isYou: true,
          },
        ]}
        funRating={null}
        firedRules={[]}
        onChangeFunRating={() => undefined}
        onVoteRule={() => undefined}
        onPlayAgain={() => undefined}
        onHome={() => undefined}
      />,
    );

    const share = screen.getByRole('link', { name: '𝕏 でシェアする' });
    const intent = new URL(share.getAttribute('href')!);
    expect(intent.searchParams.get('text')).toBe('富豪でした');
    expect(
      screen.getByRole('link', { name: '☕ 楽しかったら開発を支援する' }),
    ).toBeTruthy();
  });

  it('きほんモード相当では支援導線を隠せる', () => {
    render(
      <SetResultScreen
        ranks={[]}
        funRating={null}
        firedRules={[]}
        onChangeFunRating={() => undefined}
        onVoteRule={() => undefined}
        onPlayAgain={() => undefined}
        onHome={() => undefined}
        showSupport={false}
      />,
    );
    expect(screen.queryByRole('link', { name: /支援/u })).toBeNull();
  });

  it('E8未導入のマルチプレイ画面では未保存の評価UIを出さない', () => {
    render(
      <SetResultScreen
        ranks={[]}
        funRating={null}
        firedRules={[]}
        onChangeFunRating={() => undefined}
        onVoteRule={() => undefined}
        onPlayAgain={() => undefined}
        onHome={() => undefined}
        showEvaluation={false}
      />,
    );

    expect(
      screen.queryByRole('radiogroup', {
        name: 'このセットはおもしろかった?',
      }),
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: 'もう1セットあそぶ' }),
    ).toBeTruthy();
  });

  it('評価UIが無効でも、そのセットで発動したルール名を表示する', () => {
    render(
      <SetResultScreen
        ranks={[]}
        funRating={null}
        firedRules={[
          { ruleId: 'r0001-revolution', name: '革命返し', vote: null },
        ]}
        onChangeFunRating={() => undefined}
        onVoteRule={() => undefined}
        onPlayAgain={() => undefined}
        onHome={() => undefined}
        showEvaluation={false}
      />,
    );

    expect(screen.getByText('発動したルール')).toBeTruthy();
    expect(screen.getByText('革命返し')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /高評価/ })).toBeNull();
  });

  it('1位を花形カードにして合計点を出し、各戦の順位推移は出さない', () => {
    render(
      <SetResultScreen
        ranks={[
          {
            place: 1,
            name: 'あなた',
            kind: 'human',
            title: '大富豪',
            totalPoints: 13,
            isYou: true,
          },
        ]}
        funRating={null}
        firedRules={[]}
        onChangeFunRating={() => undefined}
        onVoteRule={() => undefined}
        onPlayAgain={() => undefined}
        onHome={() => undefined}
        showEvaluation={false}
      />,
    );

    expect(screen.getByText('13点')).toBeTruthy();
    expect(screen.queryByText(/→/)).toBeNull();
  });

  it('紙吹雪は自分が1位のときだけ出す', () => {
    const props = {
      funRating: null,
      firedRules: [],
      onChangeFunRating: () => undefined,
      onVoteRule: () => undefined,
      onPlayAgain: () => undefined,
      onHome: () => undefined,
      showEvaluation: false,
    } as const;
    const champion = {
      place: 1,
      name: 'あなた',
      kind: 'human' as const,
      title: '大富豪',
      totalPoints: 13,
    };

    const won = render(
      <SetResultScreen {...props} ranks={[{ ...champion, isYou: true }]} />,
    );
    expect(
      won.container.querySelector(`.${confettiStyles.field}`),
    ).toBeTruthy();
    cleanup();

    const lost = render(
      <SetResultScreen
        {...props}
        ranks={[
          { ...champion, name: 'プレイヤーB', kind: 'ai', isYou: false },
          {
            place: 2,
            name: 'あなた',
            kind: 'human',
            title: '富豪',
            totalPoints: 10,
            isYou: true,
          },
        ]}
      />,
    );
    expect(lost.container.querySelector(`.${confettiStyles.field}`)).toBeNull();
  });

  it('継続回答後は未回答の人を表示し、二重回答を無効化する', () => {
    render(
      <SetResultScreen
        ranks={[]}
        funRating={null}
        firedRules={[]}
        onChangeFunRating={() => undefined}
        onVoteRule={() => undefined}
        onPlayAgain={() => undefined}
        onHome={() => undefined}
        showEvaluation={false}
        waitingFor={['プレイヤーB']}
      />,
    );

    expect(screen.getByRole('status').textContent).toBe(
      'プレイヤーB を待っています…',
    );
    expect(
      screen
        .getByRole('button', { name: '待っています…' })
        .hasAttribute('disabled'),
    ).toBe(true);
  });

  it('初回だけ卒業を唯一のprimaryにし、通常時は次セットをprimaryへ戻す', async () => {
    const user = userEvent.setup();
    const onPlayCommunity = vi.fn();
    const props = {
      ranks: [],
      funRating: null,
      firedRules: [],
      onChangeFunRating: () => undefined,
      onVoteRule: () => undefined,
      onPlayAgain: () => undefined,
      onPlayCommunity,
      onHome: () => undefined,
      showEvaluation: false,
    } as const;
    const view = render(<SetResultScreen {...props} emphasizePlayCommunity />);

    const again = screen.getByRole('button', {
      name: 'もう1セットあそぶ',
    });
    const community = screen.getByRole('button', {
      name: 'みんなのルールであそんでみる',
    });
    expect(again.parentElement).toBe(community.parentElement);
    expect(
      [...again.parentElement!.children].indexOf(community),
    ).toBeGreaterThan([...again.parentElement!.children].indexOf(again));
    expect(community.classList.contains(buttonStyles.primary!)).toBe(true);
    expect(again.classList.contains(buttonStyles.primary!)).toBe(false);
    expect(
      view.container.querySelectorAll(`.${buttonStyles.primary}`),
    ).toHaveLength(1);

    view.rerender(<SetResultScreen {...props} />);
    expect(again.classList.contains(buttonStyles.primary!)).toBe(true);
    expect(community.classList.contains(buttonStyles.primary!)).toBe(false);
    expect(
      view.container.querySelectorAll(`.${buttonStyles.primary}`),
    ).toHaveLength(1);

    await user.click(community);
    expect(onPlayCommunity).toHaveBeenCalledOnce();
  });

  it('卒業コールバックがなければ導線を表示しない', () => {
    render(
      <SetResultScreen
        ranks={[]}
        funRating={null}
        firedRules={[]}
        onChangeFunRating={() => undefined}
        onVoteRule={() => undefined}
        onPlayAgain={() => undefined}
        onHome={() => undefined}
        showEvaluation={false}
      />,
    );

    expect(
      screen.queryByRole('button', {
        name: 'みんなのルールであそんでみる',
      }),
    ).toBeNull();
  });

  it('卒業処理中は3つの行動を無効化し、失敗を操作のそばへ出す', () => {
    render(
      <SetResultScreen
        ranks={[]}
        funRating={null}
        firedRules={[]}
        onChangeFunRating={() => undefined}
        onVoteRule={() => undefined}
        onPlayAgain={() => undefined}
        onPlayCommunity={() => undefined}
        onHome={() => undefined}
        showEvaluation={false}
        actionPending
        actionError="みんなのルールへ進めませんでした。もう一度ためしてください。"
      />,
    );

    for (const name of [
      'もう1セットあそぶ',
      'みんなのルールであそんでみる',
      'ホームへ',
    ]) {
      expect(
        screen.getByRole('button', { name }).hasAttribute('disabled'),
      ).toBe(true);
    }
    expect(screen.getByRole('alert').textContent).toContain(
      'もう一度ためしてください',
    );
  });

  it('次セット回答後も卒業導線は有効に残し、待つ部屋から移れる', () => {
    render(
      <SetResultScreen
        ranks={[]}
        funRating={null}
        firedRules={[]}
        onChangeFunRating={() => undefined}
        onVoteRule={() => undefined}
        onPlayAgain={() => undefined}
        onPlayCommunity={() => undefined}
        onHome={() => undefined}
        showEvaluation={false}
        waitingFor={['プレイヤーB']}
      />,
    );

    expect(
      screen
        .getByRole('button', { name: '待っています…' })
        .hasAttribute('disabled'),
    ).toBe(true);
    expect(
      screen
        .getByRole('button', {
          name: 'みんなのルールであそんでみる',
        })
        .hasAttribute('disabled'),
    ).toBe(false);
  });

  it('セットリザルトには登録導線を出さない', () => {
    render(
      <SetResultScreen
        ranks={[]}
        funRating={null}
        firedRules={[]}
        onChangeFunRating={() => undefined}
        onVoteRule={() => undefined}
        onPlayAgain={() => undefined}
        onHome={() => undefined}
        showEvaluation={false}
      />,
    );
    expect(screen.queryByRole('button', { name: '記録を残す' })).toBeNull();
  });
});
