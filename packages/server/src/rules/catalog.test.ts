import { describe, expect, it, vi } from 'vitest';

import { RuleCatalogService } from './catalog.js';

describe('RuleCatalogService', () => {
  it('公開対象をフィルタ・ページングし、未実装指標はnullで返す', () => {
    const catalog = vi.fn(() => ({
      summary: {
        implemented: 3,
        active: 2,
        removed: 1,
        prefectureCoverage: 2,
      },
      total: 1,
      items: [
        {
          id: 'r0003',
          slug: 'rule-3',
          name: '都落ち',
          description: '大富豪が最下位になると脱落します。',
          kind: 'local' as const,
          prefecture: '埼玉県',
          proposalId: 'proposal-3',
          status: 'removed' as const,
          disabledReason: null,
          createdAt: 3_000,
          updatedAt: 4_000,
        },
      ],
    }));
    const service = new RuleCatalogService(
      { catalog },
      { eliminationEnabled: true },
    );

    expect(
      service.list(
        new URLSearchParams({
          prefecture: '埼玉県',
          status: 'removed',
          kind: 'local',
          sort: 'recent',
          order: 'asc',
          limit: '10',
          offset: '20',
        }),
      ),
    ).toEqual({
      status: 200,
      body: {
        summary: {
          implemented: 3,
          active: 2,
          removed: 1,
          prefectureCoverage: 2,
        },
        page: { total: 1, limit: 10, offset: 20 },
        items: [
          {
            id: 'r0003',
            name: '都落ち',
            description: '大富豪が最下位になると脱落します。',
            kind: 'local',
            prefecture: '埼玉県',
            status: 'removed',
            priority: null,
            popularity: null,
            implementedAt: '1970-01-01T00:00:03.000Z',
            removedAt: '1970-01-01T00:00:04.000Z',
          },
        ],
      },
    });
    expect(catalog).toHaveBeenCalledWith({
      includeRemoved: true,
      prefecture: '埼玉県',
      status: 'removed',
      kind: 'local',
      order: 'asc',
      limit: 10,
      offset: 20,
    });
  });

  it('未知のソートと範囲外ページサイズを拒否する', () => {
    const service = new RuleCatalogService({ catalog: vi.fn() });
    expect(service.list(new URLSearchParams({ sort: 'popularity' }))).toEqual({
      status: 400,
      body: { error: 'invalid_query', field: 'sort' },
    });
    expect(service.list(new URLSearchParams({ limit: '101' }))).toEqual({
      status: 400,
      body: { error: 'invalid_query', field: 'limit' },
    });
  });

  it('淘汰機能の解禁前はactiveだけを公開対象にする', () => {
    const catalog = vi.fn(() => ({
      summary: {
        implemented: 0,
        active: 0,
        removed: 0,
        prefectureCoverage: 0,
      },
      total: 0,
      items: [],
    }));
    new RuleCatalogService({ catalog }).list(
      new URLSearchParams({ status: 'removed' }),
    );
    expect(catalog).toHaveBeenCalledWith({
      includeRemoved: false,
      status: 'removed',
      order: 'desc',
      limit: 30,
      offset: 0,
    });
  });
});
