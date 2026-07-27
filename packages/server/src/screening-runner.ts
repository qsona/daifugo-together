import {
  CodexAppServerJudge,
  DEFAULT_SCREENING_MODEL,
  StdioAppServerRpc,
} from './injection/app-server-judge.js';
import type {
  PendingLocalScreening,
  RecordLocalVerdictResult,
} from './injection/local-screening.js';
import { runScreeningBatch } from './injection/screening-batch.js';

function option(name: string): string | null {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : null;
}

function positiveIntegerOption(name: string, fallback: number): number {
  const raw = option(name);
  const value = raw === null ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function effort(): 'low' | 'medium' | 'high' | 'xhigh' | 'max' {
  const value = option('--effort') ?? 'medium';
  if (
    value !== 'low' &&
    value !== 'medium' &&
    value !== 'high' &&
    value !== 'xhigh' &&
    value !== 'max'
  ) {
    throw new Error('--effort must be low, medium, high, xhigh, or max');
  }
  return value;
}

function adminToken(): string {
  const token = process.env.ADMIN_PIPELINE_TOKEN?.trim();
  if (!token) throw new Error('ADMIN_PIPELINE_TOKEN is required');
  return token;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`admin API returned non-JSON (${String(response.status)})`);
  }
}

async function requestJson(
  url: URL,
  token: string,
  init: RequestInit = {},
): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body === undefined
        ? {}
        : { 'content-type': 'application/json' }),
    },
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(
      `admin API ${String(response.status)}: ${JSON.stringify(body)}`,
    );
  }
  return body;
}

function pendingItems(value: unknown): PendingLocalScreening[] {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('items' in value) ||
    !Array.isArray(value.items)
  ) {
    throw new Error('admin API returned an invalid screening list');
  }
  return value.items as PendingLocalScreening[];
}

function recorded(value: unknown): RecordLocalVerdictResult {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('status' in value) ||
    (value.status !== 'recorded' &&
      value.status !== 'already_recorded' &&
      value.status !== 'not_found' &&
      value.status !== 'invalid')
  ) {
    throw new Error('admin API returned an invalid verdict result');
  }
  return value as RecordLocalVerdictResult;
}

const baseUrl = new URL(
  option('--base-url') ??
    process.env.DAIFUGO_ADMIN_URL ??
    'http://127.0.0.1:3000',
);
const token = adminToken();
const model = option('--model') ?? DEFAULT_SCREENING_MODEL;
const limit = positiveIntegerOption('--limit', 100);
const timeoutMs = positiveIntegerOption(
  '--timeout-ms',
  Number(process.env.JUDGE_TIMEOUT_MS ?? 60_000),
);
const attempts = positiveIntegerOption(
  '--retries',
  Number(process.env.JUDGE_RETRY ?? 3),
);
const reasoningEffort = effort();
const listUrl = new URL('/admin/pipeline/screening', baseUrl);
const items = pendingItems(await requestJson(listUrl, token)).slice(0, limit);

if (items.length === 0) {
  process.stdout.write(`${JSON.stringify({ status: 'idle', processed: 0 })}\n`);
} else {
  const summary = await runScreeningBatch({
    items,
    attempts,
    judge: async (item) => {
      const rpc = await StdioAppServerRpc.start({
        ...(process.env.CODEX_BIN ? { codexBin: process.env.CODEX_BIN } : {}),
        timeoutMs,
      });
      try {
        return await new CodexAppServerJudge({
          rpc,
          model,
          effort: reasoningEffort,
        }).judge(item);
      } finally {
        rpc.close();
      }
    },
    record: async (item, verdict) =>
      recorded(
        await requestJson(
          new URL(
            `/admin/proposals/${encodeURIComponent(item.proposal.id)}/check`,
            baseUrl,
          ),
          token,
          { method: 'POST', body: JSON.stringify(verdict) },
        ),
      ),
    onEvent: (event) => {
      process[event.status === 'failed' ? 'stderr' : 'stdout'].write(
        `${JSON.stringify({
          proposalId: event.proposalId,
          status: event.status,
          attempt: event.attempt,
          ...(event.result?.status === 'recorded'
            ? { finalVerdict: event.result.result.finalVerdict }
            : {}),
          ...(event.error instanceof Error
            ? { error: event.error.message }
            : {}),
          model,
        })}\n`,
      );
    },
  });
  process.stdout.write(
    `${JSON.stringify({ status: 'complete', ...summary, model })}\n`,
  );
}
