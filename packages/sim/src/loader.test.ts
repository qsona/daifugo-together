import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { loadRuleModules } from './loader.js';

const roots: string[] = [];

async function fixture(
  options: { mismatch?: boolean; excluded?: boolean } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'rule-loader-'));
  roots.push(root);
  const id = 'r0001-example';
  const meta = {
    ruleId: id,
    name: 'Example',
    description: 'Example',
    kind: 'original',
    proposalId: 'proposal-1',
    contractVersion: 1,
    messages: {},
  };
  await mkdir(join(root, id), { recursive: true });
  await mkdir(join(root, 'dist', id), { recursive: true });
  await writeFile(
    join(root, 'rules-exclude.json'),
    `${JSON.stringify(options.excluded ? [id] : [])}\n`,
  );
  await writeFile(join(root, id, 'meta.json'), JSON.stringify(meta));
  await writeFile(
    join(root, 'dist', id, 'rule.js'),
    `export const rule = ${JSON.stringify({
      meta: options.mismatch ? { ...meta, ruleId: 'r9999-other' } : meta,
      hooks: {},
    })};\n`,
  );
  return { root, id };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('compiled rule loader', () => {
  it('compiled rule exportとmeta.json一致を検証して読む', async () => {
    const { root, id } = await fixture();

    await expect(
      loadRuleModules({ rulesRoot: root, newRuleId: id }),
    ).resolves.toMatchObject([{ meta: { ruleId: id } }]);
  });

  it('rule.ts側のmeta差し替えを拒否する', async () => {
    const { root, id } = await fixture({ mismatch: true });

    await expect(
      loadRuleModules({ rulesRoot: root, newRuleId: id }),
    ).rejects.toThrow('rule.ts meta differs from meta.json');
  });

  it('all構成ではexclude済みルールを読み込まない', async () => {
    const { root, id } = await fixture({ excluded: true });

    await expect(loadRuleModules({ rulesRoot: root })).resolves.toEqual([]);
    await expect(
      loadRuleModules({ rulesRoot: root, newRuleId: id }),
    ).resolves.toHaveLength(1);
  });
});
