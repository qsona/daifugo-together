import { describe, expect, it } from 'vitest';

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
            prefectureCoverage: 0,
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
