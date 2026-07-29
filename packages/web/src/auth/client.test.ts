import { describe, expect, it, vi } from 'vitest';

import { AuthClient } from './client';

describe('AuthClient', () => {
  it('beginは現在のtokenをURLへ載せずform POSTする', () => {
    let submittedAction = '';
    let submittedMethod = '';
    let submittedToken: HTMLInputElement | null = null;
    let wasAttached = false;
    const submit = vi
      .spyOn(HTMLFormElement.prototype, 'submit')
      .mockImplementation(function (this: HTMLFormElement) {
        submittedAction = this.action;
        submittedMethod = this.method;
        submittedToken = this.querySelector<HTMLInputElement>(
          'input[name="userToken"]',
        );
        wasAttached = document.body.contains(this);
      });
    const client = new AuthClient('https://game.example.test');

    client.begin('current-secret-token');

    expect(submittedMethod).toBe('post');
    expect(submittedAction).toBe('https://game.example.test/auth/google/begin');
    expect(submittedAction).not.toContain('current-secret-token');
    expect(submittedToken).toMatchObject({
      type: 'hidden',
      value: 'current-secret-token',
    });
    expect(submit).toHaveBeenCalledOnce();
    expect(wasAttached).toBe(true);
    expect(document.querySelector('input[name="userToken"]')).toBeNull();

    submit.mockRestore();
  });

  it('completeはottをbodyで引き換え、URLへ載せない', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          outcome: 'switched',
          userToken: 'restored-token',
          displayName: 'ゲスト1',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const client = new AuthClient('https://game.example.test', fetcher);

    await expect(client.complete('one-time-code')).resolves.toMatchObject({
      outcome: 'switched',
      userToken: 'restored-token',
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://game.example.test/api/auth/complete',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ ott: 'one-time-code' }),
      }),
    );
    expect(fetcher.mock.calls[0]?.[0]).not.toContain('one-time-code');
  });
});
