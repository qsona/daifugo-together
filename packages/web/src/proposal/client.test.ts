import { describe, expect, it, vi } from 'vitest';

import { ProposalApiError, ProposalClient } from './client';

const request = {
  kind: 'original' as const,
  prefectureCode: null,
  name: '革命返し',
  body: '革命中にもう一度革命すると元へ戻る。',
};

describe('ProposalClient', () => {
  it('fetcherをクライアントのメソッドreceiverなしで呼ぶ', async () => {
    const fetcher = async function (this: unknown) {
      expect(this).toBeUndefined();
      return new Response(
        JSON.stringify({
          outcome: 'accepted',
          proposal: {
            id: 'proposal-browser-fetch',
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
        { status: 200 },
      );
    };
    const client = new ProposalClient(
      'https://example.test',
      { getItem: () => 'shared-session-token' },
      fetcher as typeof fetch,
    );

    await client.submit(request);
  });

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

  it('本人向けカード一覧を読み、同じtokenで異議申し立てを送る', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            active: 1,
            limit: 2,
            cards: [
              {
                id: 7,
                issuedAt: 1,
                status: 'active',
                expiresAt: 2,
                appeal: null,
              },
            ],
            suspension: null,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ appealId: 9, status: 'open' }), {
          status: 201,
        }),
      );
    const client = new ProposalClient(
      'https://example.test',
      { getItem: () => 'shared-session-token' },
      fetcher,
    );

    await expect(client.getYellowCards()).resolves.toMatchObject({
      active: 1,
      cards: [{ id: 7 }],
    });
    await expect(client.appealYellowCard(7, '誤検出です')).resolves.toEqual({
      appealId: 9,
      status: 'open',
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'https://example.test/api/yellow-cards/7/appeal',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer shared-session-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ comment: '誤検出です' }),
      },
    );
  });

  it('マイ提案をGETし、明示seenだけをPOSTする', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [], unreadCount: 2 }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new ProposalClient(
      'https://example.test',
      { getItem: () => 'shared-session-token' },
      fetcher,
    );

    await expect(client.mine()).resolves.toEqual({
      items: [],
      unreadCount: 2,
    });
    await expect(client.markProposalsSeen(1234)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'https://example.test/api/proposals/mine',
      {
        headers: { authorization: 'Bearer shared-session-token' },
      },
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'https://example.test/api/proposals/seen',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer shared-session-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ seenThrough: 1234 }),
      },
    );
  });
});
