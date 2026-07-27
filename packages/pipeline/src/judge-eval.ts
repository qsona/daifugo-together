import {
  DEFAULT_SCREENING_MODEL,
  StdioAppServerRpc,
  type PendingCxJudgement,
} from '@daifugo/server';

import { CodexCxJudge } from './app-server-judge.js';
import { CX_JUDGE_CORPUS } from './judge-corpus.js';

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

const model = option('--model') ?? DEFAULT_SCREENING_MODEL;
const selectedIds = new Set(
  (option('--ids') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
);
const corpus =
  selectedIds.size === 0
    ? CX_JUDGE_CORPUS
    : CX_JUDGE_CORPUS.filter(({ id }) => selectedIds.has(id));
if (corpus.length === 0) throw new Error('--ids did not match any corpus case');
const rpc = await StdioAppServerRpc.start({
  ...(process.env.CODEX_BIN ? { codexBin: process.env.CODEX_BIN } : {}),
  timeoutMs: positiveIntegerOption('--timeout-ms', 120_000),
});
const judge = new CodexCxJudge({ rpc, model, effort: effort() });
let matches = 0;
let latencyMs = 0;

try {
  for (const sample of corpus) {
    const item: PendingCxJudgement = {
      proposal: {
        id: sample.id,
        userId: 'cx-judge-eval',
        kind: 'original',
        prefectureCode: null,
        name: sample.name,
        body: sample.body,
      },
      signals: {
        proposalId: sample.id,
        userId: 'cx-judge-eval',
        detectorVersion: 'eval',
        inputText: `${sample.name}\n${sample.body}`,
        normalizedText: `${sample.name}\n${sample.body}`,
        inputHash: sample.id,
        layer0: { invisibleChars: false, lengthExceeded: false },
        layer1: { hard: [], soft: [] },
        layer2: {
          hasCodeFence: false,
          hasUrl: false,
          hasBase64Like: false,
          langSwitch: false,
          systemVocabDensity: false,
          trailingDirective: false,
        },
        createdAt: 0,
      },
      check: {
        id: 1,
        proposalId: sample.id,
        userId: 'cx-judge-eval',
        inputText: `${sample.name}\n${sample.body}`,
        finalVerdict: 'pass',
        llmVerdict: 'clean',
        reviewFlag: false,
        createdAt: 0,
      },
      existingRules: sample.existingRules ?? [],
    };
    const result = await judge.judge(item);
    const actual = {
      verdict: result.verdict,
      rejectCategory: result.rejectCategory,
      rejectSubtype: result.rejectSubtype,
    };
    const matched =
      actual.verdict === sample.expected.verdict &&
      actual.rejectCategory === sample.expected.rejectCategory &&
      actual.rejectSubtype === sample.expected.rejectSubtype;
    if (matched) matches += 1;
    latencyMs += result.latencyMs;
    process.stdout.write(
      `${JSON.stringify({
        id: sample.id,
        expected: sample.expected,
        actual,
        matched,
        confidence: result.confidence,
        latencyMs: result.latencyMs,
      })}\n`,
    );
  }
} finally {
  rpc.close();
}

const summary = {
  model,
  exactMatches: matches,
  total: corpus.length,
  exactMatchRate: matches / corpus.length,
  averageLatencyMs: Math.round(latencyMs / corpus.length),
};
process.stdout.write(`${JSON.stringify({ summary })}\n`);
if (matches !== corpus.length) process.exitCode = 1;
