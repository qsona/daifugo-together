import { describe, expect, it } from 'vitest';

import { buildXShareUrl } from './links';

describe('buildXShareUrl', () => {
  it('投稿文・追跡付きサービスURL・共通ハッシュタグをintentに入れる', () => {
    const url = new URL(buildXShareUrl('大富豪になりました', '/rules'));
    expect(`${url.origin}${url.pathname}`).toBe('https://x.com/intent/post');
    expect(url.searchParams.get('text')).toBe('大富豪になりました');
    expect(url.searchParams.get('url')).toBe(
      'https://daifugo-together.fly.dev/rules?from=share',
    );
    expect(url.searchParams.get('hashtags')).toBe('みんなでつくろう大富豪');
  });
});
