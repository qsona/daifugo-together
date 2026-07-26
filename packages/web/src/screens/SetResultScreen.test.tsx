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
});
