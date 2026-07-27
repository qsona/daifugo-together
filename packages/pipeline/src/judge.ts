import {
  CodexAppServerJudge,
  DEFAULT_SCREENING_MODEL,
  StdioAppServerRpc,
  runScreeningBatch,
  type PendingLocalScreening,
  type PendingCxJudgement,
  type PendingVerdictConfirmation,
  type RecordLocalVerdictResult,
  type PipelineMutationResult,
} from '@daifugo/server';
import { CodexCxJudge } from './app-server-judge.js';

type ScreeningItem =
  | ({ stage: 'e6' } & PendingLocalScreening)
  | ({ stage: 'cx01' } & PendingCxJudgement)
  | ({ stage: 'confirmation' } & PendingVerdictConfirmation);

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

function pendingItems(value: unknown): ScreeningItem[] {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('items' in value) ||
    !Array.isArray(value.items)
  ) {
    throw new Error('admin API returned an invalid screening list');
  }
  return value.items as ScreeningItem[];
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

function pipelineResult(value: unknown): PipelineMutationResult {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('status' in value) ||
    (value.status !== 'recorded' &&
      value.status !== 'already_recorded' &&
      value.status !== 'confirmed' &&
      value.status !== 'already_confirmed' &&
      value.status !== 'not_found' &&
      value.status !== 'conflict' &&
      value.status !== 'invalid')
  ) {
    throw new Error('admin API returned an invalid pipeline result');
  }
  return value as PipelineMutationResult;
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
  const e6Items = items.filter(
    (item): item is Extract<ScreeningItem, { stage: 'e6' }> =>
      item.stage === 'e6',
  );
  let cxItems = items.filter(
    (item): item is Extract<ScreeningItem, { stage: 'cx01' }> =>
      item.stage === 'cx01',
  );
  const e6Summary =
    e6Items.length === 0
      ? { processed: 0, failed: 0 }
      : await runScreeningBatch({
          items: e6Items,
          attempts,
          judge: async (item) => {
            const rpc = await StdioAppServerRpc.start({
              ...(process.env.CODEX_BIN
                ? { codexBin: process.env.CODEX_BIN }
                : {}),
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
                stage: 'e6',
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
  if (e6Items.length > 0) {
    const e6ProposalIds = new Set(e6Items.map((item) => item.proposal.id));
    const existingCxIds = new Set(cxItems.map((item) => item.proposal.id));
    const newlyEligible = pendingItems(
      await requestJson(listUrl, token),
    ).filter(
      (item): item is Extract<ScreeningItem, { stage: 'cx01' }> =>
        item.stage === 'cx01' &&
        e6ProposalIds.has(item.proposal.id) &&
        !existingCxIds.has(item.proposal.id),
    );
    cxItems = [...cxItems, ...newlyEligible];
  }
  const cxSummary = {
    processed: cxItems.length,
    recorded: 0,
    alreadyRecorded: 0,
    failed: 0,
  };
  for (const item of cxItems) {
    let complete = false;
    const runId = randomUUID();
    for (let attempt = 1; attempt <= attempts && !complete; attempt += 1) {
      let rpc: StdioAppServerRpc | null = null;
      try {
        rpc = await StdioAppServerRpc.start({
          ...(process.env.CODEX_BIN ? { codexBin: process.env.CODEX_BIN } : {}),
          timeoutMs,
        });
        const judgement = await new CodexCxJudge({
          rpc,
          model,
          effort: reasoningEffort,
        }).judge(item);
        const result = pipelineResult(
          await requestJson(
            new URL(
              `/admin/proposals/${encodeURIComponent(item.proposal.id)}/judge`,
              baseUrl,
            ),
            token,
            {
              method: 'POST',
              body: JSON.stringify({
                action: 'record_ai',
                payload: { ...judgement, runId },
              }),
            },
          ),
        );
        if (result.status === 'recorded') cxSummary.recorded += 1;
        else if (result.status === 'already_recorded') {
          cxSummary.alreadyRecorded += 1;
        } else {
          throw new Error(`CX-01 record failed: ${result.status}`);
        }
        process.stdout.write(
          `${JSON.stringify({
            stage: 'cx01',
            proposalId: item.proposal.id,
            status: result.status,
            attempt,
            verdict:
              result.status === 'recorded' ||
              result.status === 'already_recorded'
                ? result.judgement.verdict
                : undefined,
            model,
          })}\n`,
        );
        complete = true;
      } catch (error) {
        const invalidOutput =
          error instanceof Error &&
          (error.message.includes('invalid structured output') ||
            error.message.includes('non-JSON output'));
        const finalAttempt =
          attempt >= attempts || (invalidOutput && attempt >= 2);
        process[finalAttempt ? 'stderr' : 'stdout'].write(
          `${JSON.stringify({
            stage: 'cx01',
            proposalId: item.proposal.id,
            status: finalAttempt ? 'failed' : 'retrying',
            attempt,
            error: error instanceof Error ? error.message : String(error),
            model,
          })}\n`,
        );
        if (finalAttempt) {
          cxSummary.failed += 1;
          complete = true;
        }
      } finally {
        rpc?.close();
      }
    }
  }
  const confirmations = pendingItems(await requestJson(listUrl, token)).filter(
    (item): item is Extract<ScreeningItem, { stage: 'confirmation' }> =>
      item.stage === 'confirmation',
  );
  for (const item of confirmations) {
    process.stdout.write(
      `${JSON.stringify({
        stage: 'confirmation',
        source: item.source,
        proposal: item.proposal,
        ...(item.source === 'e6'
          ? {
              checkId: item.check.id,
              finalVerdict: item.check.finalVerdict,
            }
          : {
              judgementId: item.judgement.id,
              verdict: item.judgement.verdict,
              rejectCategory: item.judgement.rejectCategory,
              rejectSubtype: item.judgement.rejectSubtype,
              reasonForUser: item.judgement.reasonForUser,
              reasonInternal: item.judgement.reasonInternal,
              spec: item.judgement.spec,
              scaffoldMeta: item.judgement.scaffoldMeta,
              confidence: item.judgement.confidence,
            }),
      })}\n`,
    );
  }
  const summary = {
    processed: e6Summary.processed + cxSummary.processed,
    failed: e6Summary.failed + cxSummary.failed,
    e6: e6Summary,
    cx01: cxSummary,
    awaitingConfirmation: confirmations.length,
  };
  process.stdout.write(
    `${JSON.stringify({ status: 'complete', ...summary, model })}\n`,
  );
}
import { randomUUID } from 'node:crypto';
