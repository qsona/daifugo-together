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

  it('completeはottをURLへ載せずform POSTする', () => {
    let submittedAction = '';
    let submittedOtt: HTMLInputElement | null = null;
    const submit = vi
      .spyOn(HTMLFormElement.prototype, 'submit')
      .mockImplementation(function (this: HTMLFormElement) {
        submittedAction = this.action;
        submittedOtt =
          this.querySelector<HTMLInputElement>('input[name="ott"]');
      });
    const client = new AuthClient('https://game.example.test');

    client.complete('one-time-code');

    expect(submittedAction).toBe(
      'https://game.example.test/auth/google/complete',
    );
    expect(submittedAction).not.toContain('one-time-code');
    expect(submittedOtt).toMatchObject({
      type: 'hidden',
      value: 'one-time-code',
    });
    expect(document.querySelector('input[name="ott"]')).toBeNull();

    submit.mockRestore();
  });

  it('一時cookieの認証結果を一度だけ取り出す', () => {
    let cookie =
      '__Secure-daifugo-auth-result=' +
      encodeURIComponent(
        JSON.stringify({
          outcome: 'switched',
          userToken: 'restored-token',
          displayName: 'ゲスト1',
        }),
      );
    const documentRef = {
      get cookie() {
        return cookie;
      },
      set cookie(value: string) {
        cookie = value;
      },
    } as Document;
    const client = new AuthClient('https://game.example.test', documentRef);

    expect(client.takeResult()).toMatchObject({
      outcome: 'switched',
      userToken: 'restored-token',
    });
    expect(cookie).toContain('Max-Age=0');
  });
});
