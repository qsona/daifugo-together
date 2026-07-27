import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('generated rule registry', () => {
  it('実ruleディレクトリだけを決定順で静的importへ変換する', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rule-registry-'));
    directories.push(root);
    await Promise.all([
      mkdir(join(root, 'r0010-second')),
      mkdir(join(root, 'r0002-first')),
      mkdir(join(root, 'not-a-rule')),
    ]);
    await Promise.all([
      writeFile(
        join(root, 'r0010-second', 'rule.ts'),
        "export const rule = { meta: { ruleId: 'r0010-second' }, hooks: {} };\n",
      ),
      writeFile(
        join(root, 'r0002-first', 'rule.ts'),
        "export const rule = { meta: { ruleId: 'r0002-first' }, hooks: {} };\n",
      ),
    ]);

    await execute(process.execPath, [
      resolve('packages/rules/scripts/generate-registry.mjs'),
      '--root',
      root,
    ]);
    const generated = await readFile(
      join(root, 'generated', 'registry.ts'),
      'utf8',
    );

    expect(generated).toContain(
      "import { rule as rule0 } from '../r0002-first/rule.js';",
    );
    expect(generated).toContain(
      "import { rule as rule1 } from '../r0010-second/rule.js';",
    );
    expect(generated.indexOf('r0002-first')).toBeLessThan(
      generated.indexOf('r0010-second'),
    );
    expect(generated).toContain("slug: 'first', version: 1");
    expect(generated).toContain("slug: 'second', version: 1");
    expect(generated).not.toContain('not-a-rule');
  });
});
