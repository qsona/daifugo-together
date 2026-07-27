import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('production runtime artifacts', () => {
  it('serverのworkspace実行依存とweb成果物をruntime imageへ含める', async () => {
    const dockerfile = await readFile(
      new URL('../Dockerfile', import.meta.url),
      'utf8',
    );

    for (const packageName of ['ai', 'core', 'rules', 'server', 'web']) {
      expect(dockerfile).toContain(
        `COPY --from=builder /app/packages/${packageName}/dist packages/${packageName}/dist`,
      );
    }
  });
});
