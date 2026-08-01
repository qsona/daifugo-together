import { describe, expect, it, vi } from 'vitest';

import { RuleCatalogClient } from './client';

describe('RuleCatalogClient', () => {
  it('fetcherをクライアントのメソッドreceiverなしで呼ぶ', async () => {
    const fetcher = async function (this: unknown) {
      expect(this).toBeUndefined();
      return new Response(
        JSON.stringify({
          summary: {
            implemented: 0,
            active: 0,
            removed: 0,
          },
          page: { total: 0, limit: 30, offset: 0 },
          items: [],
        }),
        { status: 200 },
      );
    };
    const client = new RuleCatalogClient(
      'https://example.test',
      fetcher as typeof fetch,
    );

    await client.list();
  });
});

describe('RuleCatalogClient.get', () => {
  it('ruleIdをURLエンコードして1件取得する', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: 'r0001-eight-cut',
            name: '8切り',
            description: '8を含む手を出すと場を流す。',
            kind: 'local',
            prefecture: '埼玉県',
            status: 'active',
            priority: null,
            popularity: null,
            implementedAt: '2026-07-01T00:00:00.000Z',
            removedAt: null,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    const client = new RuleCatalogClient('https://example.test', fetcher);

    await expect(client.get('r0001-eight-cut')).resolves.toMatchObject({
      name: '8切り',
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://example.test/api/rules/r0001-eight-cut',
    );
  });

  it('404は取得失敗として扱う', async () => {
    const client = new RuleCatalogClient(
      'https://example.test',
      async () => new Response('{}', { status: 404 }),
    );

    await expect(client.get('missing')).rejects.toThrow(
      'rule_catalog_unavailable',
    );
  });
});
