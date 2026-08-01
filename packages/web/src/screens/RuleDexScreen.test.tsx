import {
  act,
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
        implementedAt: '1970-01-01T00:00:01.000Z',
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
        implementedAt: '1970-01-01T00:00:02.000Z',
        removedAt: '1970-01-01T00:00:03.000Z',
      },
    ],
  };
}

describe('RuleDexScreen', () => {
  const features = {
    priority: false,
    popularity: false,
    elimination: true,
    ruleDex: true,
  } as const;

  it('種類・状態・説明を表示し、都道府県と未実装指標を表示しない', async () => {
    const api: Pick<RuleCatalogApi, 'list'> = {
      list: vi.fn(async () => response()),
    };
    const { container } = render(
      <RuleDexScreen api={api} onBack={vi.fn()} features={features} />,
    );
    expect(await screen.findByText('県ありルール')).toBeTruthy();
    expect(screen.getAllByText('ローカル')).toHaveLength(2);
    expect(screen.getByText('説明')).toBeTruthy();
    expect(screen.getAllByText('引退')).toHaveLength(2);
    expect(container.textContent).not.toMatch(/埼玉県|都道府県|人気|優先/u);
  });

  it('ルール名・都道府県・説明の先頭をXシェア文に入れる', async () => {
    render(
      <RuleDexScreen
        api={{ list: vi.fn(async () => response()) }}
        onBack={vi.fn()}
        features={features}
      />,
    );
    await screen.findByText('県ありルール');
    const links = screen.getAllByRole('link', {
      name: '𝕏 このルールをシェア',
    });
    const intent = new URL(links[0]!.getAttribute('href')!);
    expect(intent.searchParams.get('text')).toBe(
      'ルール図鑑「県ありルール」(埼玉県で遊ばれていた報告)\n説明',
    );
    expect(intent.searchParams.get('url')).toBe(
      'https://daifugo-together.fly.dev/rules?from=share',
    );
  });

  it('状態・区分をAND条件として再取得する', async () => {
    const list = vi.fn(async () => response());
    render(
      <RuleDexScreen api={{ list }} onBack={vi.fn()} features={features} />,
    );
    await screen.findByText('県ありルール');

    fireEvent.change(screen.getByLabelText('状態'), {
      target: { value: 'removed' },
    });
    fireEvent.change(screen.getByLabelText('種類'), {
      target: { value: 'local' },
    });

    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith({
        status: 'removed',
        kind: 'local',
        sort: 'recent',
        order: 'desc',
        limit: 30,
        offset: 0,
      }),
    );
  });

  it('行を展開して説明全文とISO日時由来の日付を表示する', async () => {
    render(
      <RuleDexScreen
        api={{ list: vi.fn(async () => response()) }}
        onBack={vi.fn()}
        features={features}
      />,
    );
    const rule = await screen.findByRole('button', {
      name: /県ありルール/u,
    });
    fireEvent.click(rule);
    const detail = screen.getByRole('region', {
      name: '県ありルールの詳細',
    });
    expect(detail.textContent).toContain('説明');
    expect(detail.textContent).toContain('1970年1月1日');
  });

  it('フィルタ連打では古いレスポンスで新しい結果を上書きしない', async () => {
    let resolveFirst!: (value: ReturnType<typeof response>) => void;
    let resolveSecond!: (value: ReturnType<typeof response>) => void;
    const first = new Promise<ReturnType<typeof response>>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<ReturnType<typeof response>>((resolve) => {
      resolveSecond = resolve;
    });
    const list = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => second);
    render(
      <RuleDexScreen api={{ list }} onBack={vi.fn()} features={features} />,
    );
    fireEvent.change(screen.getByLabelText('種類'), {
      target: { value: 'local' },
    });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolveSecond({
        ...response(),
        items: [{ ...response().items[0]!, name: '新しい結果' }],
      });
    });
    expect(await screen.findByText('新しい結果')).toBeTruthy();
    await act(async () => {
      resolveFirst({
        ...response(),
        items: [{ ...response().items[0]!, name: '古い結果' }],
      });
    });
    expect(screen.queryByText('古い結果')).toBeNull();
    expect(screen.getByText('新しい結果')).toBeTruthy();
  });

  it('初回取得失敗から再試行できる', async () => {
    const list = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(response());
    render(
      <RuleDexScreen api={{ list }} onBack={vi.fn()} features={features} />,
    );
    expect(
      await screen.findByText('ルール図鑑を読み込めませんでした。'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'もう一度ためす' }));
    expect(await screen.findByText('県ありルール')).toBeTruthy();
  });

  it('淘汰機能の解禁前は排除済みの選択肢と行を描画しない', async () => {
    render(
      <RuleDexScreen
        api={{ list: vi.fn(async () => response()) }}
        onBack={vi.fn()}
        features={{ ...features, elimination: false }}
      />,
    );
    expect(await screen.findByText('県ありルール')).toBeTruthy();
    expect(screen.queryByText('昔のルール')).toBeNull();
    expect(screen.queryByRole('option', { name: '引退' })).toBeNull();
  });
});
