import type { AiJudgementResult, PendingCxJudgement } from '@daifugo/server';
import { describe, expect, it, vi } from 'vitest';

import { runCxJudgementBatch } from './cx-batch.js';

function item(id: string): PendingCxJudgement {
  return {
    proposal: {
      id,
      userId: `user-${id}`,
      kind: 'original',
      prefectureCode: null,
      name: `rule-${id}`,
      body: '8を出したら場を流す。',
    },
    signals: {
      proposalId: id,
      userId: `user-${id}`,
      detectorVersion: 'test',
      inputText: 'text',
      normalizedText: 'text',
      inputHash: 'hash',
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
      createdAt: 1,
    },
    check: {
      id: 1,
      proposalId: id,
      userId: `user-${id}`,
      inputText: 'text',
      finalVerdict: 'pass',
      llmVerdict: 'clean',
      reviewFlag: false,
      createdAt: 2,
    },
    existingRules: [],
  };
}

function judgement(): AiJudgementResult {
  return {
    verdict: 'needs_review',
    rejectCategory: null,
    rejectSubtype: null,
    reasonForUser: null,
    reasonInternal: '要確認',
    spec: null,
    scaffoldMeta: null,
    extensionNeeded: null,
    confidence: 0.5,
    model: 'gpt-5.6-sol',
    promptVersion: 'cx01-v1',
    latencyMs: 1,
  };
}

describe('CX-01 judgement batch', () => {
  it('不正出力を2回で打ち切り、後続提案を処理する', async () => {
    const attempts = new Map<string, number>();
    const events: Array<{ proposalId: string; status: string }> = [];
    const summary = await runCxJudgementBatch({
      items: [item('bad'), item('good')],
      attempts: 3,
      createRunId: () => 'run-id',
      judge: async (target) => {
        attempts.set(
          target.proposal.id,
          (attempts.get(target.proposal.id) ?? 0) + 1,
        );
        if (target.proposal.id === 'bad') {
          throw new Error('CX-01 turn returned invalid structured output');
        }
        return judgement();
      },
      record: async () => ({
        status: 'recorded',
        judgement: {} as never,
      }),
      onEvent: ({ proposalId, status }) => {
        events.push({ proposalId, status });
      },
    });

    expect(summary).toEqual({
      processed: 2,
      recorded: 1,
      alreadyRecorded: 0,
      failed: 1,
    });
    expect(attempts).toEqual(
      new Map([
        ['bad', 2],
        ['good', 1],
      ]),
    );
    expect(events).toContainEqual({
      proposalId: 'good',
      status: 'recorded',
    });
  });

  it('App Server障害は3回再試行し、同じrun IDを記録へ渡す', async () => {
    const judge = vi
      .fn<() => Promise<AiJudgementResult>>()
      .mockRejectedValueOnce(new Error('app-server unavailable'))
      .mockRejectedValueOnce(new Error('app-server unavailable'))
      .mockResolvedValueOnce(judgement());
    const record = vi.fn(async () => ({
      status: 'recorded' as const,
      judgement: {} as never,
    }));

    await expect(
      runCxJudgementBatch({
        items: [item('retry')],
        attempts: 3,
        createRunId: () => 'stable-run-id',
        judge,
        record,
      }),
    ).resolves.toMatchObject({ recorded: 1, failed: 0 });
    expect(judge).toHaveBeenCalledTimes(3);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        proposal: expect.objectContaining({ id: 'retry' }),
      }),
      judgement(),
      'stable-run-id',
    );
  });
});
