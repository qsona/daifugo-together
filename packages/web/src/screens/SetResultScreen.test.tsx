import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SetResultScreen } from './SetResultScreen';

afterEach(cleanup);

describe('SetResultScreen phase boundary', () => {
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

  it('順位行にセット合計点を出す', () => {
    render(
      <SetResultScreen
        ranks={[
          {
            place: 1,
            name: 'あなた',
            kind: 'human',
            title: '大富豪',
            history: [1, 1, 2],
            totalPoints: 13,
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

  it('卒業コールバックがあると次セットと並べて表示し、押下を渡す', async () => {
    const user = userEvent.setup();
    const onPlayCommunity = vi.fn();
    render(
      <SetResultScreen
        ranks={[]}
        funRating={null}
        firedRules={[]}
        onChangeFunRating={() => undefined}
        onVoteRule={() => undefined}
        onPlayAgain={() => undefined}
        onPlayCommunity={onPlayCommunity}
        onHome={() => undefined}
        showEvaluation={false}
        emphasizePlayCommunity
      />,
    );

    expect(
      screen.getByRole('button', { name: 'もう1セットあそぶ' }),
    ).toBeTruthy();
    await user.click(
      screen.getByRole('button', {
        name: 'みんなのルールで あそんでみる',
      }),
    );
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
        name: 'みんなのルールで あそんでみる',
      }),
    ).toBeNull();
  });
});
