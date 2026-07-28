import { afterEach, describe, expect, it, vi } from 'vitest';

import { EvaluationClient } from './client';

describe('EvaluationClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('Bearer付きでセットIDをエンコードして評価を取得する', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ setRating: 'fun', ruleVotes: [] }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new EvaluationClient('https://example.test', {
      getItem: () => 'user-token',
    });

    await expect(client.get('set / 1')).resolves.toEqual({
      setRating: 'fun',
      ruleVotes: [],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/api/sets/set%20%2F%201/evaluation',
      {
        method: 'GET',
        headers: { authorization: 'Bearer user-token' },
      },
    );
  });

  it('localStorageが利用不能でも同期例外を外へ漏らさない', async () => {
    const client = new EvaluationClient('https://example.test', {
      getItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
    });

    await expect(client.get('set-1')).rejects.toThrow(
      '評価セッションが見つかりません',
    );
  });
});
