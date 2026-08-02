import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { inspectGeneratedRule } from './inspector.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function scaffold(testSource: string) {
  const directory = await mkdtemp(join(tmpdir(), 'rule-inspector-'));
  directories.push(directory);
  const meta = '{}\n';
  const spec = '{}\n';
  const metaPath = join(directory, 'meta.json');
  const specPath = join(directory, 'SPEC.json');
  await Promise.all([
    writeFile(metaPath, meta),
    writeFile(specPath, spec),
    writeFile(
      join(directory, 'rule.ts'),
      "import type { RuleModule } from '@daifugo/core';\nexport const rule: RuleModule = { meta: {} as never, hooks: {} };\n",
    ),
    writeFile(join(directory, 'rule.test.ts'), testSource),
  ]);
  return {
    directory,
    metaPath,
    specPath,
    metaSha256: sha256(meta),
    specSha256: sha256(spec),
  };
}

describe('generated rule import inspection', () => {
  it('rule.test.tsから同じディレクトリのrule.jsをimportできる', async () => {
    const generated = await scaffold(
      "import { rule } from './rule.js';\nimport { it } from 'vitest';\nit('rule', () => void rule);\n",
    );

    await expect(inspectGeneratedRule(generated)).resolves.toEqual({
      ok: true,
    });
  });

  it('rule.test.tsから別の相対モジュールはimportできない', async () => {
    const generated = await scaffold(
      "import { rule } from '../other/rule.js';\nimport { it } from 'vitest';\nit('rule', () => void rule);\n",
    );

    await expect(inspectGeneratedRule(generated)).resolves.toEqual({
      ok: false,
      violations: ['rule.test.ts: imports forbidden module ../other/rule.js'],
    });
  });
});
