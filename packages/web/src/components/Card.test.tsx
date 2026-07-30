import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Card } from './Card';

const CARD = {
  id: 'S03',
  suit: 'spade',
  rank: '3',
} as const;

describe('TU-02: 出せないカードの拒否フィードバック', () => {
  afterEach(cleanup);

  it('連続タップごとに首振りを再始動し、終了時に拒否クラスを外す', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const onDimmedTap = vi.fn();
    render(
      <Card card={CARD} dimmed onToggle={onToggle} onDimmedTap={onDimmedTap} />,
    );
    const card = screen.getByRole('button', { name: 'スペードの3' });
    const restingClassName = card.className;

    await user.click(card);
    const rejectedClassName = card.className;
    expect(rejectedClassName).not.toBe(restingClassName);

    // jsdom には AnimationEvent がなく、React は WebKit 名へフォールバックする。
    fireEvent(card, new Event('webkitAnimationEnd', { bubbles: true }));
    expect(card.className).toBe(restingClassName);

    await user.click(card);
    expect(card.className).toBe(rejectedClassName);
    expect(onDimmedTap).toHaveBeenCalledTimes(2);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('aria-disabledでもnative disabledにせず、EnterとSpaceでも選択しない', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const onDimmedTap = vi.fn();
    render(
      <Card card={CARD} dimmed onToggle={onToggle} onDimmedTap={onDimmedTap} />,
    );
    const card = screen.getByRole('button', { name: 'スペードの3' });

    expect(card.getAttribute('aria-disabled')).toBe('true');
    expect(card.hasAttribute('disabled')).toBe(false);

    await user.tab();
    expect(document.activeElement).toBe(card);
    await user.keyboard('{Enter}');
    await user.keyboard('[Space]');

    expect(onDimmedTap).toHaveBeenCalledTimes(2);
    expect(onToggle).not.toHaveBeenCalled();
    expect(card.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('ジョーカーの描画', () => {
  afterEach(cleanup);

  it('スート記号なしで JOKER 表記だけを描き、既定の読み上げ名は「ジョーカー」', () => {
    render(<Card card={{ id: 'JK0', rank: 'JOKER' }} />);
    const card = screen.getByRole('img', { name: 'ジョーカー' });
    // スートのグリフ(♠♥♦♣)を含まない。
    expect(card.textContent).toBe('JOKER');
  });

  it('KV と同じ星を左端の帯と面の 2 か所に描く(重なっても帯の星で識別できる)', () => {
    render(<Card card={{ id: 'JK0', rank: 'JOKER' }} />);
    const card = screen.getByRole('img', { name: 'ジョーカー' });
    expect(card.querySelectorAll('svg').length).toBe(2);
    // 星は装飾なので、読み上げには出さない。
    for (const svg of card.querySelectorAll('svg')) {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('label 指定で 2 枚のジョーカーを読み上げ名で区別できる', () => {
    const onToggle = vi.fn();
    render(
      <>
        <Card
          card={{ id: 'JK0', rank: 'JOKER', label: 'ジョーカー1' }}
          onToggle={onToggle}
        />
        <Card
          card={{ id: 'JK1', rank: 'JOKER', label: 'ジョーカー2' }}
          onToggle={onToggle}
        />
      </>,
    );
    expect(screen.getByRole('button', { name: 'ジョーカー1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'ジョーカー2' })).toBeTruthy();
  });
});
