import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const script = fileURLToPath(
  new URL('./check-ai-boundaries.mjs', import.meta.url),
);
const fixture = fileURLToPath(
  new URL('./fixtures/ai-network-boundary', import.meta.url),
);

describe('AI dependency boundary', () => {
  it('実パッケージにLLM SDK・ネットワークI/Oがない', () => {
    expect(() =>
      execFileSync(process.execPath, [script], {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });

  it('ネットワーク利用を含むfixtureを拒否する', () => {
    expect(() =>
      execFileSync(process.execPath, [script, fixture], {
        stdio: 'pipe',
      }),
    ).toThrow();
  });
});
