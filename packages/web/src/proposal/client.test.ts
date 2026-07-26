import { describe, expect, it, vi } from 'vitest';

import { ProposalApiError, ProposalClient } from './client';

const request = {
  kind: 'original' as const,
  prefectureCode: null,
  name: '革命返し',
  body: '革命中にもう一度革命すると元へ戻る。',
};

describe('ProposalClient', () => {
  it('Socket.IOと同じ匿名tokenをBearerで送る', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            outcome: 'accepted',
            proposal: {
              id: 'proposal-1',
              ...request,
              prefectureName: null,
              status: 'screening',
              reason: null,
              releasedRuleId: null,
              popularity: null,
              priorityRank: null,
              unread: true,
              createdAt: 1,
              statusChangedAt: 1,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    const client = new ProposalClient(
      'https://example.test',
      { getItem: () => 'shared-session-token' },
      fetcher as typeof fetch,
    );

    await expect(client.submit(request)).resolves.toMatchObject({
      outcome: 'accepted',
      proposal: { id: 'proposal-1' },
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://example.test/api/proposals',
      expect.objectContaining({
        method: 'POST',
        headers: {
          authorization: 'Bearer shared-session-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify(request),
      }),
    );
  });

  it('tokenがまだ無い場合はネットワークへ出さない', async () => {
    const fetcher = vi.fn();
    const client = new ProposalClient(
      'https://example.test',
      { getItem: () => null },
      fetcher as typeof fetch,
    );

    await expect(client.submit(request)).rejects.toMatchObject({
      name: 'ProposalApiError',
      status: 401,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('サーバーのフィールドエラーをUI用エラーとして保つ', async () => {
    const client = new ProposalClient(
      'https://example.test',
      { getItem: () => 'shared-session-token' },
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: 'validation_failed',
              fields: [{ field: 'name', code: 'too_long' }],
            }),
            { status: 400, headers: { 'content-type': 'application/json' } },
          ),
      ) as typeof fetch,
    );

    const error = await client
      .submit(request)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProposalApiError);
    expect(error).toMatchObject({
      status: 400,
      fields: [{ field: 'name', code: 'too_long' }],
    });
  });
});
