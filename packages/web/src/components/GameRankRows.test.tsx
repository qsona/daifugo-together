import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { GameRankRows } from './GameRankRows';

afterEach(cleanup);

const RANKS = [
  {
    place: 1,
    name: 'たろう',
    kind: 'human' as const,
    title: '大富豪',
    gainedPoints: 5,
    totalPoints: 13,
    isYou: true,
  },
  {
    place: 2,
    name: 'プレイヤーB',
    kind: 'ai' as const,
    title: '富豪',
    gainedPoints: 3,
    totalPoints: 9,
  },
];

describe('GameRankRows', () => {
  it('順位・称号・獲得順位点を出す', () => {
    render(<GameRankRows ranks={RANKS} countUp={false} />);

    expect(screen.getByText('大富豪')).toBeTruthy();
    expect(screen.getByText('+5')).toBeTruthy();
    expect(screen.getByText('+3')).toBeTruthy();
  });

  it('自分の名前と「自分」の目印を両方出す', () => {
    render(<GameRankRows ranks={RANKS} countUp={false} />);

    expect(screen.getByLabelText('たろう（自分）')).toBeTruthy();
    expect(screen.getByText('たろう')).toBeTruthy();
    expect(screen.getByText('自分')).toBeTruthy();
  });

  it('合計点は獲得前から数え上がり、最後は合計に落ち着く', async () => {
    render(<GameRankRows ranks={RANKS} />);

    expect(screen.getByText('8点')).toBeTruthy();
    expect(screen.getByText('6点')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText('13点')).toBeTruthy();
    });
    expect(screen.getByText('9点')).toBeTruthy();
  });

  it('カウントアップを止めると最初から合計を出す', () => {
    render(<GameRankRows ranks={RANKS} countUp={false} />);

    expect(screen.getByText('13点')).toBeTruthy();
    expect(screen.queryByText('8点')).toBeNull();
  });
});
