import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { PendingVerdictConfirmation } from '@daifugo/server';

import { buildDesignHandoff } from './design-handoff.js';

function option(name: string): string | null {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : null;
}

function positionalProposalId(): string {
  const value = process.argv[2];
  if (!value || value.startsWith('--')) {
    throw new Error(
      'usage: design-handoff-cli PROPOSAL_ID [--out PATH] [--base-url URL]',
    );
  }
  return value;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`admin API returned non-JSON (${String(response.status)})`);
  }
}

async function requestJson(url: URL, token: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(
      `admin API ${String(response.status)}: ${JSON.stringify(body)}`,
    );
  }
  return body;
}

function screeningItems(
  value: unknown,
): Array<PendingVerdictConfirmation & { stage: string }> {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('items' in value) ||
    !Array.isArray(value.items)
  ) {
    throw new Error('admin API returned an invalid screening list');
  }
  return value.items as Array<PendingVerdictConfirmation & { stage: string }>;
}

function findCx01Confirmation(
  items: Array<PendingVerdictConfirmation & { stage: string }>,
  proposalId: string,
): Extract<PendingVerdictConfirmation, { source: 'cx01' }> {
  const found = items.find(
    (item) =>
      item.stage === 'confirmation' &&
      item.source === 'cx01' &&
      item.proposal.id === proposalId,
  );
  if (!found) {
    throw new Error(
      `確定待ちのCX-01判定が見つかりません(proposalId=${proposalId})`,
    );
  }
  return found as Extract<PendingVerdictConfirmation, { source: 'cx01' }>;
}

function defaultOutputPath(proposalId: string): string {
  return join(
    tmpdir(),
    'daifugo-design-handoff',
    `proposal-${proposalId}.json`,
  );
}

const proposalId = positionalProposalId();
const token = process.env.ADMIN_PIPELINE_TOKEN?.trim();
if (!token) throw new Error('ADMIN_PIPELINE_TOKEN is required');
const baseUrl = new URL(
  option('--base-url') ??
    process.env.DAIFUGO_ADMIN_URL ??
    'http://127.0.0.1:3000',
);
const outputPath = option('--out') ?? defaultOutputPath(proposalId);

const listed = await requestJson(
  new URL('/admin/pipeline/screening', baseUrl),
  token,
);
const item = findCx01Confirmation(screeningItems(listed), proposalId);
const document = buildDesignHandoff(item, new Date().toISOString());

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o600,
});
process.stdout.write(`${outputPath}\n`);
