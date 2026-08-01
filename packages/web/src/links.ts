export const SERVICE_NAME = 'みんなでつくろう 大富豪';
export const SERVICE_URL = 'https://daifugo-together.fly.dev';
export const SUPPORT_URL: string = 'https://ofuse.me/qsona';
export const X_ACCOUNT_URL = 'https://x.com/qsona';

const SHARE_HASHTAGS = 'みんなでつくろう大富豪';

export function buildXShareUrl(text: string, path = '/'): string {
  const sharedUrl = new URL(path, SERVICE_URL);
  sharedUrl.searchParams.set('from', 'share');
  const params = new URLSearchParams({
    text,
    url: sharedUrl.href,
    hashtags: SHARE_HASHTAGS,
  });
  return `https://x.com/intent/post?${params.toString()}`;
}
