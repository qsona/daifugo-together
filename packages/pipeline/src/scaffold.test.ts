import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { QueuedImplementation } from '@daifugo/server';
import { afterEach, describe, expect, it } from 'vitest';

import { createRuleScaffold } from './scaffold.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

function queued(engineFeatures?: string[]): QueuedImplementation {
  return {
    job: {
      id: 1,
      proposalId: 'proposal-1',
      phase: 'queued',
      attempt: 1,
      ciRerun: 0,
      ruleId: 'r0001-kaidan',
      slug: 'kaidan',
      branch: null,
      prNumber: null,
      headSha: null,
      mergeSha: null,
      scaffoldSha: null,
      promptVersion: null,
      errorCode: null,
      errorNote: null,
      createdAt: 1,
      updatedAt: 1,
    },
    proposal: {
      id: 'proposal-1',
      kind: 'original',
      prefectureCode: null,
      prefecture: null,
      name: '階段',
      body: '同じスートの連続する3枚以上を出せる。',
    },
    passedCheckId: 2,
    approvedJudgementId: 3,
    spec: {
      specVersion: 1,
      name: '階段',
      summary: '同じスートの連続する3枚以上を階段として出せる。',
      hooks: [],
      effects: [],
      ...(engineFeatures === undefined ? {} : { engineFeatures }),
      testPoints: ['3枚の階段が出せる'],
      notes: '',
      source: {
        kind: 'original',
        title: '階段',
        body: '同じスートの連続する3枚以上を出せる。',
      },
    },
    scaffoldMeta: { slug: 'kaidan', messages: {} },
  };
}

async function scaffoldMeta(
  item: QueuedImplementation,
): Promise<Record<string, unknown>> {
  const root = await mkdtemp(join(tmpdir(), 'scaffold-test-'));
  directories.push(root);
  const result = await createRuleScaffold(item, root);
  return JSON.parse(await readFile(result.metaPath, 'utf8')) as Record<
    string,
    unknown
  >;
}

describe('createRuleScaffold', () => {
  it('SPECのengineFeaturesをmeta.jsonへ転記する', async () => {
    const item = queued(['sequence']);
    const root = await mkdtemp(join(tmpdir(), 'scaffold-test-'));
    directories.push(root);
    const result = await createRuleScaffold(item, root);
    const metaSource = await readFile(result.metaPath, 'utf8');
    const specSource = await readFile(result.specPath, 'utf8');
    const meta = JSON.parse(metaSource) as Record<string, unknown>;
    expect(meta).toMatchObject({
      ruleId: 'r0001-kaidan',
      name: '階段',
      contractVersion: 1,
      engineFeatures: ['sequence'],
    });
    expect(metaSource).toContain('  "engineFeatures": ["sequence"],\n');
    expect(specSource).toContain('  "engineFeatures": ["sequence"],\n');
  });

  it('engineFeaturesが空・未指定のSPECではmeta.jsonへ載せない', async () => {
    for (const item of [queued([]), queued()]) {
      const meta = await scaffoldMeta(item);
      expect(meta).not.toHaveProperty('engineFeatures');
    }
  });
});
