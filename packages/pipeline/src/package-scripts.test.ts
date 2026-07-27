import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const runtimeScripts = [
  'confirm',
  'judge',
  'judge:eval',
  'implement',
  'implement:resume',
  'implement:retry',
  'implement:fail',
  'implement:checks',
  'implement:merged',
  'implement:release-status',
  'implement:release',
] as const;

describe('pipeline local environment', () => {
  it('loads the ignored root .env.local for every runtime command', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { scripts: Record<string, string> };
    const gitignore = await readFile(
      new URL('../../../.gitignore', import.meta.url),
      'utf8',
    );

    for (const script of runtimeScripts) {
      expect(packageJson.scripts[script]).toContain(
        'node --env-file-if-exists=../../.env.local ',
      );
    }
    expect(gitignore.split(/\r?\n/u)).toContain('.env.local');
  });
});
