import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { QueuedImplementation } from '@daifugo/server';

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
  const scaffold = expectedRuleScaffold(item, rulesRoot);
  const ruleMeta = ruleMetadata(item);
  await mkdir(scaffold.directory, { recursive: true });
  await writeImmutable(scaffold.metaPath, json(ruleMeta));
  await writeImmutable(scaffold.specPath, json(item.spec));
  return scaffold;
}

// meta.json の内容。core の RuleMeta 型には依存せず、SPEC からの転記として構成する。
function ruleMetadata(item: QueuedImplementation) {
  const engineFeatures = item.spec.engineFeatures ?? [];
  return {
    ruleId: item.job.ruleId,
    name: item.spec.name,
    description: item.spec.summary,
    kind: item.proposal.kind,
    ...(item.proposal.prefecture === null
      ? {}
      : { prefecture: item.proposal.prefecture }),
    proposalId: item.proposal.id,
    contractVersion: 1,
    ...(engineFeatures.length === 0 ? {} : { engineFeatures }),
    messages: item.scaffoldMeta.messages,
  };
}

export function expectedRuleScaffold(
  item: QueuedImplementation,
  rulesRoot: string,
): ScaffoldResult {
  const directory = join(rulesRoot, item.job.ruleId);
  const metaPath = join(directory, 'meta.json');
  const specPath = join(directory, 'SPEC.json');
  const meta = json(ruleMetadata(item));
  const spec = json(item.spec);
  return {
    directory,
    metaPath,
    specPath,
    metaSha256: sha256(meta),
    specSha256: sha256(spec),
  };
}
