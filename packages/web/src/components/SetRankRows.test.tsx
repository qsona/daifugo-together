import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SetRankRows } from './SetRankRows';
import styles from './SetRankRows.module.css';

afterEach(cleanup);

const RANKS = [
  {
    place: 1,
    name: 'あなた',
    kind: 'human' as const,
    title: '大富豪',
    totalPoints: 13,
    isYou: true,
  },
  {
    place: 2,
    name: 'プレイヤーB',
    kind: 'ai' as const,
    title: '富豪',
    totalPoints: 10,
  },
];

describe('SetRankRows', () => {
  it('1位を花形カードにし、称号と合計点を出す', () => {
    const view = render(<SetRankRows ranks={RANKS} />);

    const champion = view.container.querySelector(`.${styles.champion}`);
    expect(champion).toBeTruthy();
    expect(champion!.textContent).toContain('1位');
    expect(champion!.textContent).toContain('大富豪');
    expect(champion!.textContent).toContain('あなた');
    expect(champion!.textContent).toContain('13点');
  });

  it('2位以下は行にし、自分の行だけ目印を付ける', () => {
    const view = render(
      <SetRankRows
        ranks={[
          { ...RANKS[0]!, name: 'プレイヤーB', kind: 'ai', isYou: false },
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

    expect(screen.getByText('2位')).toBeTruthy();
    expect(screen.getByText('10点')).toBeTruthy();
    expect(view.container.querySelectorAll(`.${styles.you}`)).toHaveLength(1);
    expect(
      view.container.querySelector(`.${styles.champion}`)!.className,
    ).not.toContain(styles.you);
  });

  it('各戦の順位の推移は出さない', () => {
    render(<SetRankRows ranks={RANKS} />);

    expect(screen.queryByText(/→/)).toBeNull();
  });

  it('同率1位の全員を花形カードで表示する', () => {
    const tiedRanks = [
      RANKS[0]!,
      { ...RANKS[1]!, place: 1, name: 'プレイヤーB', isYou: false },
    ];

    const view = render(<SetRankRows ranks={tiedRanks} />);

    expect(view.container.querySelectorAll(`.${styles.champion}`)).toHaveLength(
      2,
    );
    expect(screen.getAllByText('1位')).toHaveLength(2);
    expect(screen.getByText('あなた')).toBeTruthy();
    expect(screen.getByText('プレイヤーB')).toBeTruthy();
  });
});
