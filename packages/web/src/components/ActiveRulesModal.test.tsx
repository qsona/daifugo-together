import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ActiveRulesModal } from './ActiveRulesModal';

afterEach(cleanup);

describe('ActiveRulesModal', () => {
  it('ルール名だけを並べ、タップでruleIdを返す', async () => {
    const user = userEvent.setup();
    const onSelectRule = vi.fn();
    const { container } = render(
      <ActiveRulesModal
        rules={[
          { ruleId: 'r2', name: '二枚縛り' },
          { ruleId: 'r1', name: '8切り' },
        ]}
        onSelectRule={onSelectRule}
        onClose={vi.fn()}
      />,
    );

    expect(container.textContent).not.toMatch(/人気|優先|都道府県/u);
    await user.click(screen.getByRole('button', { name: '8切り' }));
    expect(onSelectRule).toHaveBeenCalledWith('r1');
  });

  it('0件でも空状態を出す', () => {
    render(
      <ActiveRulesModal rules={[]} onSelectRule={vi.fn()} onClose={vi.fn()} />,
    );

    expect(screen.getByText('追加ルールはありません')).toBeTruthy();
  });

  it('対局中に画面を離れる図鑑導線を置かない', () => {
    render(
      <ActiveRulesModal
        rules={[{ ruleId: 'r1', name: '8切り' }]}
        onSelectRule={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: '図鑑でくわしく' })).toBeNull();
  });
});
