import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HandTray } from './HandTray';
import styles from './HandTray.module.css';

const SELECTED_SLOT_CLASS = styles.selectedSlot;
if (!SELECTED_SLOT_CLASS) {
  throw new Error('selectedSlot class is required');
}

const CARDS = [
  { id: 'C03', suit: 'club', rank: '3' },
  { id: 'D03', suit: 'diamond', rank: '3' },
  { id: 'H03', suit: 'heart', rank: '3' },
  { id: 'S03', suit: 'spade', rank: '3' },
] as const;

describe('HandTray の選択札タップ領域', () => {
  afterEach(cleanup);

  it('末尾以外の選択札数を、44px幅を配るギャップ数として渡す', () => {
    render(
      <HandTray
        cards={CARDS}
        selectedIds={['C03', 'H03', 'S03']}
        onToggle={vi.fn()}
      />,
    );

    const list = screen.getByRole('list');
    expect(list.style.getPropertyValue('--selected-gaps')).toBe('2');
    expect(list.style.getPropertyValue('--unselected-gaps')).toBe('1');

    for (const name of ['クラブの3', 'ハートの3', 'スペードの3']) {
      const slot = screen.getByRole('button', { name }).closest('li');
      expect(slot?.classList.contains(SELECTED_SLOT_CLASS)).toBe(true);
    }
    expect(
      screen
        .getByRole('button', { name: 'ダイヤの3' })
        .closest('li')
        ?.classList.contains(SELECTED_SLOT_CLASS),
    ).toBe(false);
  });

  it('選択札を再タップすると従来どおり onToggle へ渡す', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <HandTray cards={CARDS} selectedIds={['D03']} onToggle={onToggle} />,
    );

    await user.click(screen.getByRole('button', { name: 'ダイヤの3' }));

    expect(onToggle).toHaveBeenCalledWith('D03');
  });
});
