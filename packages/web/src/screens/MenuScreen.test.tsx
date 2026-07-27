import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MenuScreen } from './MenuScreen';

afterEach(cleanup);

describe('MenuScreen', () => {
  it('マイ提案に未読件数を表示し、99件を超えたら省略する', () => {
    const props = {
      onPlay: vi.fn(),
      onPropose: vi.fn(),
      onEncyclopedia: vi.fn(),
      onMyProposals: vi.fn(),
      onHowToPlay: vi.fn(),
    };
    const { rerender } = render(
      <MenuScreen {...props} unreadProposalCount={3} />,
    );
    expect(screen.getByLabelText('未読提案').textContent).toBe('3');

    rerender(<MenuScreen {...props} unreadProposalCount={100} />);
    expect(screen.getByLabelText('未読提案').textContent).toBe('99+');
  });
});
