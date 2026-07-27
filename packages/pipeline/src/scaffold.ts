import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { QueuedImplementation } from '@daifugo/server';
import type { RuleMeta } from '@daifugo/core';

export interface ScaffoldResult {
  directory: string;
  metaPath: string;
  specPath: string;
  metaSha256: string;
  specSha256: string;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function writeImmutable(path: string, content: string): Promise<void> {
  try {
    await writeFile(path, content, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !('code' in error) ||
      error.code !== 'EEXIST'
    ) {
      throw error;
    }
    const existing = await readFile(path, 'utf8');
    if (existing !== content) {
      throw new Error(`immutable scaffold file differs: ${path}`, {
        cause: error,
      });
    }
  }
}

export async function createRuleScaffold(
  item: QueuedImplementation,
  rulesRoot: string,
): Promise<ScaffoldResult> {
  const directory = join(rulesRoot, item.job.ruleId);
  await mkdir(directory, { recursive: true });
  const metaPath = join(directory, 'meta.json');
  const specPath = join(directory, 'SPEC.json');
  const ruleMeta: RuleMeta = {
    ruleId: item.job.ruleId,
    name: item.spec.name,
    description: item.spec.summary,
    kind: item.proposal.kind,
    ...(item.proposal.prefecture === null
      ? {}
      : { prefecture: item.proposal.prefecture }),
    proposalId: item.proposal.id,
    contractVersion: 1,
    messages: item.scaffoldMeta.messages,
  };
  const meta = json(ruleMeta);
  const spec = json(item.spec);
  await writeImmutable(metaPath, meta);
  await writeImmutable(specPath, spec);
  return {
    directory,
    metaPath,
    specPath,
    metaSha256: sha256(meta),
    specSha256: sha256(spec),
  };
}
