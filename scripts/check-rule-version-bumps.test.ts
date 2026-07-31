import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { synchronizeRuleVersions } from './check-rule-version-bumps.mjs';

const roots: string[] = [];
const firstRule = 'r0007-spade-3-gaeshi';

async function write(root: string, path: string, contents: string) {
  const absolute = join(root, path);
  await mkdir(join(absolute, '..'), { recursive: true });
  await writeFile(absolute, contents);
}

async function fixture() {
  const packageRoot = await mkdtemp(join(tmpdir(), 'rule-bundles-'));
  roots.push(packageRoot);
  await write(packageRoot, `${firstRule}/rule.ts`, 'export {};\n');
  await write(
    packageRoot,
    `dist/${firstRule}/rule.js`,
    'export const rule = 1;\n',
  );
  await write(packageRoot, 'rule-versions.json', '{}\n');
  return packageRoot;
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('rule bundle version synchronization', () => {
  it('初回のbundle hashをv1のまま記録する', async () => {
    const packageRoot = await fixture();

    const result = await synchronizeRuleVersions({ packageRoot, write: true });

    expect(result).toMatchObject({
      changed: true,
      bumped: [],
      initialized: [firstRule],
    });
    expect(
      JSON.parse(
        await readFile(join(packageRoot, 'rule-versions.json'), 'utf8'),
      ),
    ).toEqual({});
    expect(
      JSON.parse(
        await readFile(join(packageRoot, 'rule-bundles.json'), 'utf8'),
      ),
    ).toEqual({
      [firstRule]: {
        version: 1,
        hash: createHash('sha256')
          .update('export const rule = 1;\n')
          .digest('hex'),
      },
    });
  });

  it('実行bundleが変わったルールだけを一度bumpする', async () => {
    const packageRoot = await fixture();
    await write(
      packageRoot,
      'rule-versions.json',
      `${JSON.stringify({ [firstRule]: 2 }, null, 2)}\n`,
    );
    await synchronizeRuleVersions({ packageRoot, write: true });
    await write(
      packageRoot,
      `dist/${firstRule}/rule.js`,
      'export const rule = 2;\n',
    );

    const changed = await synchronizeRuleVersions({ packageRoot, write: true });
    const unchanged = await synchronizeRuleVersions({
      packageRoot,
      write: true,
    });

    expect(changed.bumped).toMatchObject([
      { ruleId: firstRule, previousVersion: 2, version: 3 },
    ]);
    expect(unchanged).toMatchObject({ changed: false, bumped: [] });
    expect(
      JSON.parse(
        await readFile(join(packageRoot, 'rule-versions.json'), 'utf8'),
      ),
    ).toEqual({ [firstRule]: 3 });
  });

  it('手動で先に上げた版をさらに二重bumpしない', async () => {
    const packageRoot = await fixture();
    await write(
      packageRoot,
      'rule-versions.json',
      `${JSON.stringify({ [firstRule]: 2 }, null, 2)}\n`,
    );
    await synchronizeRuleVersions({ packageRoot, write: true });
    await write(
      packageRoot,
      'rule-versions.json',
      `${JSON.stringify({ [firstRule]: 3 }, null, 2)}\n`,
    );
    await write(
      packageRoot,
      `dist/${firstRule}/rule.js`,
      'export const rule = 3;\n',
    );

    const result = await synchronizeRuleVersions({ packageRoot, write: true });

    expect(result).toMatchObject({
      bumped: [],
      acknowledged: [{ ruleId: firstRule, previousVersion: 2, version: 3 }],
    });
    expect(
      JSON.parse(
        await readFile(join(packageRoot, 'rule-versions.json'), 'utf8'),
      ),
    ).toEqual({ [firstRule]: 3 });
  });

  it('check modeでは差分を返すがファイルを書き換えない', async () => {
    const packageRoot = await fixture();
    await synchronizeRuleVersions({ packageRoot, write: true });
    const before = await readFile(
      join(packageRoot, 'rule-bundles.json'),
      'utf8',
    );
    await write(
      packageRoot,
      `dist/${firstRule}/rule.js`,
      'export const rule = 3;\n',
    );

    const result = await synchronizeRuleVersions({ packageRoot });

    expect(result).toMatchObject({
      changed: true,
      bumped: [{ ruleId: firstRule, previousVersion: 1, version: 2 }],
    });
    expect(await readFile(join(packageRoot, 'rule-bundles.json'), 'utf8')).toBe(
      before,
    );
  });
});
