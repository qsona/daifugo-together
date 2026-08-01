import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { YellowCardModal } from './YellowCardModal';

describe('YellowCardModal', () => {
  it('理由文を含めない定型文でじまん導線を出す', () => {
    render(
      <YellowCardModal
        info={{
          verdict: 'card',
          card: { active: 1, limit: 2 },
          suspension: null,
        }}
        onClose={() => undefined}
      />,
    );

    const share = screen.getByRole('link', { name: '𝕏 じまんする' });
    expect(new URL(share.getAttribute('href')!).searchParams.get('text')).toBe(
      'みんなでつくろう大富豪で、イエローカードをもらいました🟨',
    );
  });
});
