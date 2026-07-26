import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

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
});
