import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const runtimeScripts = [
  'confirm',
  'judge',
  'judge:eval',
  'judge:review',
  'review',
  'implement',
  'implement:prepare',
  'implement:resume',
  'implement:retry',
  'implement:submit',
  'implement:fail',
  'implement:checks',
  'implement:await-merge',
  'implement:merged',
  'implement:deploy',
  'implement:release-status',
  'implement:release',
] as const;

describe('pipeline local environment', () => {
  it('runs every command through the build-on-change environment loader', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { scripts: Record<string, string> };
    const runner = await readFile(
      new URL('../scripts/run-cli.mjs', import.meta.url),
      'utf8',
    );
    const gitignore = await readFile(
      new URL('../../../.gitignore', import.meta.url),
      'utf8',
    );

    for (const script of runtimeScripts) {
      expect(packageJson.scripts[script]).toMatch(
        /^node scripts\/run-cli\.mjs dist\/.+\.js/u,
      );
      expect(packageJson.scripts[script]).not.toContain('pnpm build &&');
    }
    expect(runner).toContain("'--env-file-if-exists=../../.env.local'");
    expect(runner).toContain("argument !== '--'");
    expect(gitignore.split(/\r?\n/u)).toContain('.env.local');
  });
});
