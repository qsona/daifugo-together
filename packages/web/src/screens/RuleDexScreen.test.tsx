import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RuleCatalogApi } from '../rules/client';

import { RuleDexScreen } from './RuleDexScreen';

afterEach(cleanup);

function response() {
  return {
    summary: {
      implemented: 2,
      active: 1,
      removed: 1,
      prefectureCoverage: 1,
    },
    page: { total: 2, limit: 30, offset: 0 },
    items: [
      {
        id: 'r1',
        name: '県ありルール',
        description: '説明',
        kind: 'local' as const,
        prefecture: '埼玉県',
        status: 'active' as const,
        priority: null,
        popularity: null,
        implementedAt: 1_000,
        removedAt: null,
      },
      {
        id: 'r2',
        name: '昔のルール',
        description: '説明',
        kind: 'original' as const,
        prefecture: null,
        status: 'removed' as const,
        priority: null,
        popularity: null,
        implementedAt: 2_000,
        removedAt: 3_000,
      },
    ],
  };
}

describe('RuleDexScreen', () => {
  it('出自・状態を表示し、未実装の人気度・優先度を表示しない', async () => {
    const api: RuleCatalogApi = { list: vi.fn(async () => response()) };
    const { container } = render(<RuleDexScreen api={api} onBack={vi.fn()} />);
    expect(await screen.findByText('県ありルール')).toBeTruthy();
    expect(screen.getByText('報告: 埼玉県')).toBeTruthy();
    expect(screen.getByText('埼玉県で遊ばれていた報告')).toBeTruthy();
    expect(screen.getAllByText('排除済み')).toHaveLength(2);
    expect(container.textContent).not.toMatch(/埼玉県のルール|人気|優先/u);
  });

  it('都道府県・状態・区分をAND条件として再取得する', async () => {
    const list = vi.fn(async () => response());
    render(<RuleDexScreen api={{ list }} onBack={vi.fn()} />);
    await screen.findByText('県ありルール');

    fireEvent.change(screen.getByLabelText('都道府県'), {
      target: { value: 'none' },
    });
    fireEvent.change(screen.getByLabelText('状態'), {
      target: { value: 'removed' },
    });
    fireEvent.change(screen.getByLabelText('区分'), {
      target: { value: 'local' },
    });

    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith({
        prefecture: 'none',
        status: 'removed',
        kind: 'local',
        limit: 30,
        offset: 0,
      }),
    );
  });
});
