import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ProposalStepper } from './ProposalStepper';

afterEach(cleanup);

describe('ProposalStepper', () => {
  it('進行中のステップだけを現在地として示す', () => {
    render(
      <ProposalStepper
        steps={[
          { label: '確認中', state: 'done' },
          { label: '開発中', state: 'now' },
          { label: 'あそべる', state: 'pending' },
        ]}
      />,
    );

    const current = screen.getAllByRole('listitem', { current: 'step' });
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toContain('開発中');
    expect(current[0]?.textContent).toContain('いま');
  });

  it('通過済みのステップは支援技術に「済み」を読ませる', () => {
    render(
      <ProposalStepper
        steps={[
          { label: '確認中', state: 'done' },
          { label: '開発中', state: 'now' },
          { label: 'あそべる', state: 'pending' },
        ]}
      />,
    );

    const done = screen
      .getAllByRole('listitem')
      .find((item) => item.textContent?.includes('確認中'));
    expect(done).toBeDefined();
    expect(done?.textContent).toContain('済み');
    expect(done?.getAttribute('aria-current')).toBe(null);
  });

  it('終点のあそべる・見送りも現在地として示す', () => {
    const { rerender } = render(
      <ProposalStepper
        steps={[
          { label: '確認中', state: 'done' },
          { label: '開発中', state: 'done' },
          { label: 'あそべる', state: 'released' },
        ]}
      />,
    );
    expect(
      screen.getByRole('listitem', { current: 'step' }).textContent,
    ).toContain('あそべる');

    rerender(
      <ProposalStepper
        steps={[
          { label: '確認中', state: 'done' },
          { label: '見送り', state: 'rejected' },
        ]}
      />,
    );
    expect(
      screen.getByRole('listitem', { current: 'step' }).textContent,
    ).toContain('見送り');
  });

  it('連結線は通過済み区間と未到達区間で別のクラスを持つ', () => {
    const { container } = render(
      <ProposalStepper
        steps={[
          { label: '確認中', state: 'done' },
          { label: '開発中', state: 'now' },
          { label: 'あそべる', state: 'pending' },
        ]}
      />,
    );

    const lines = container.querySelectorAll('ol > span');
    expect(lines).toHaveLength(2);
    expect(lines[0]?.className).not.toBe(lines[1]?.className);
  });
});
