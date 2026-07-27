import {
  CodexAppServerJudge,
  StdioAppServerRpc,
} from './injection/app-server-judge.js';
import {
  finalizeDetection,
  InjectionStaticAnalyzer,
} from './injection/detector.js';
import { JUDGE_CORPUS } from './injection/judge-corpus.js';
import type { PendingLocalScreening } from './injection/local-screening.js';

function option(name: string): string | null {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : null;
}

function requiredOption(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`${name} is required`);
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

function positiveIntegerOption(name: string, fallback: number): number {
  const raw = option(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

const model = requiredOption('--model');
const selectedIds = new Set(
  (option('--ids') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
);
const corpus =
  selectedIds.size === 0
    ? JUDGE_CORPUS
    : JUDGE_CORPUS.filter(({ id }) => selectedIds.has(id));
if (corpus.length === 0) throw new Error('--ids did not match any corpus case');
const analyzer = new InjectionStaticAnalyzer();
const rpc = await StdioAppServerRpc.start({
  ...(process.env.CODEX_BIN ? { codexBin: process.env.CODEX_BIN } : {}),
  timeoutMs: positiveIntegerOption('--timeout-ms', 120_000),
});
const judge = new CodexAppServerJudge({ rpc, model, effort: effort() });
let attackCount = 0;
let blockedAttacks = 0;
let legitCount = 0;
let passedLegit = 0;
let latencyMs = 0;

try {
  for (const sample of corpus) {
    const analysis = analyzer.analyze({
      kind: 'original',
      prefectureCode: null,
      name: sample.name,
      body: sample.body,
    });
    const pending: PendingLocalScreening = {
      proposal: {
        id: sample.id,
        userId: 'judge-eval',
        kind: 'original',
        prefectureCode: null,
        name: sample.name,
        body: sample.body,
      },
      signals: {
        proposalId: sample.id,
        userId: 'judge-eval',
        detectorVersion: analysis.detectorVersion,
        inputText: analysis.inputText,
        normalizedText: analysis.normalizedText,
        inputHash: analysis.inputHash,
        layer0: analysis.layers.layer0,
        layer1: analysis.layers.layer1,
        layer2: analysis.layers.layer2,
        createdAt: 0,
      },
    };
    const l3 = await judge.judge(pending);
    const result = finalizeDetection(analysis, {
      ...l3,
      evidenceVerified:
        l3.evidence !== null && analysis.inputText.includes(l3.evidence),
    });
    const actual = result.finalVerdict === 'pass' ? 'pass' : 'block';
    const matched = actual === sample.expected;
    if (sample.expected === 'block') {
      attackCount += 1;
      if (actual === 'block') blockedAttacks += 1;
    } else {
      legitCount += 1;
      if (actual === 'pass') passedLegit += 1;
    }
    latencyMs += l3.latencyMs;
    process.stdout.write(
      `${JSON.stringify({
        id: sample.id,
        expected: sample.expected,
        actual,
        finalVerdict: result.finalVerdict,
        l3Verdict: l3.verdict,
        evidenceVerified: result.layers.llm?.evidenceVerified,
        matched,
        latencyMs: l3.latencyMs,
      })}\n`,
    );
  }
} finally {
  rpc.close();
}

const summary = {
  model,
  attackRecall: attackCount === 0 ? null : blockedAttacks / attackCount,
  legitFalsePositiveRate:
    legitCount === 0 ? null : (legitCount - passedLegit) / legitCount,
  exactMatches: blockedAttacks + passedLegit,
  total: attackCount + legitCount,
  averageLatencyMs: Math.round(latencyMs / (attackCount + legitCount)),
  passed: blockedAttacks === attackCount && passedLegit === legitCount,
};
process.stdout.write(`${JSON.stringify({ summary })}\n`);
if (!summary.passed) process.exitCode = 1;
