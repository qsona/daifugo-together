import { describe, expect, it, vi } from 'vitest';

import { RuleCatalogService } from './catalog.js';

describe('RuleCatalogService', () => {
  function storedRule(overrides: Record<string, unknown> = {}) {
    return {
      id: 'r0001-eight-cut',
      slug: 'eight-cut',
      name: '8切り',
      description: '8を含む手を出すと場を流す。',
      kind: 'local' as const,
      prefecture: '埼玉県',
      proposalId: 'proposal-1',
      status: 'active' as const,
      disabledReason: null,
      activatedAt: 1_000,
      ratingUp: 0,
      ratingDown: 0,
      popularityScore: 0.5,
      popularityUpdatedAt: null,
      priorityRank: 2,
      createdAt: 1_000,
      updatedAt: 1_000,
      ...overrides,
    };
  }

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
          activatedAt: 3_000,
          ratingUp: 0,
          ratingDown: 0,
          popularityScore: 0.5,
          popularityUpdatedAt: null,
          priorityRank: null,
          createdAt: 3_000,
          updatedAt: 4_000,
        },
      ],
    }));
    const service = new RuleCatalogService(
      { catalog, catalogItem: vi.fn() },
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
      sort: 'recent',
      order: 'asc',
      limit: 10,
      offset: 20,
    });
  });

  it('未知のソートと範囲外ページサイズを拒否する', () => {
    const service = new RuleCatalogService({
      catalog: vi.fn(),
      catalogItem: vi.fn(),
    });
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
    new RuleCatalogService({ catalog, catalogItem: vi.fn() }).list(
      new URLSearchParams({ status: 'removed' }),
    );
    expect(catalog).toHaveBeenCalledWith({
      includeRemoved: false,
      status: 'removed',
      sort: 'recent',
      order: 'desc',
      limit: 30,
      offset: 0,
    });
  });

  it('by-idで1件返す。指標のフラグは一覧と同じ扱いにする', () => {
    const catalogItem = vi.fn(() => storedRule());
    const service = new RuleCatalogService(
      { catalog: vi.fn(), catalogItem },
      { priorityEnabled: true },
    );

    expect(service.detail('r0001-eight-cut')).toEqual({
      status: 200,
      body: {
        id: 'r0001-eight-cut',
        name: '8切り',
        description: '8を含む手を出すと場を流す。',
        kind: 'local',
        prefecture: '埼玉県',
        status: 'active',
        priority: 2,
        popularity: null,
        implementedAt: new Date(1_000).toISOString(),
        removedAt: null,
      },
    });
    expect(catalogItem).toHaveBeenCalledWith('r0001-eight-cut');
  });

  /*
   * 対局中に使っているルールは、その対局中に排除されても説明できるべきなので、
   * removed は elimination フラグに関係なく返す。未公開の disabled だけは
   * 存在しない扱いにする。
   */
  it('removedは常に返し、disabledは404にする', () => {
    const removed = new RuleCatalogService({
      catalog: vi.fn(),
      catalogItem: vi.fn(() =>
        storedRule({ status: 'removed', priorityRank: null, updatedAt: 5_000 }),
      ),
    });
    const detail = removed.detail('r0001-eight-cut');
    expect(detail.status).toBe(200);
    expect(detail.status === 200 && detail.body.status).toBe('removed');
    expect(detail.status === 200 && detail.body.removedAt).toBe(
      new Date(5_000).toISOString(),
    );

    const disabled = new RuleCatalogService({
      catalog: vi.fn(),
      catalogItem: vi.fn(() => storedRule({ status: 'disabled' })),
    });
    expect(disabled.detail('r0001-eight-cut')).toEqual({
      status: 404,
      body: { error: 'rule_not_found' },
    });
  });

  it('存在しないruleIdは404にする', () => {
    const service = new RuleCatalogService({
      catalog: vi.fn(),
      catalogItem: vi.fn(() => null),
    });

    expect(service.detail('missing')).toEqual({
      status: 404,
      body: { error: 'rule_not_found' },
    });
  });
});
