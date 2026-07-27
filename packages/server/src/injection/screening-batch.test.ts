import { describe, expect, it, vi } from 'vitest';

import type {
  LocalL3Result,
  PendingLocalScreening,
} from './local-screening.js';
import { runScreeningBatch } from './screening-batch.js';

const verdict: LocalL3Result = {
  verdict: 'clean',
  reason: 'ルール説明です。',
  evidence: null,
  model: 'gpt-5.6-sol',
  latencyMs: 10,
};

function item(id: string): PendingLocalScreening {
  return {
    proposal: {
      id,
      userId: 'user-1',
      kind: 'original',
      prefectureCode: null,
      name: id,
      body: '8を出したら場が流れる。',
    },
    signals: {
      proposalId: id,
      userId: 'user-1',
      detectorVersion: 'test',
      inputText: id,
      normalizedText: id,
      inputHash: id,
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
  };
}

describe('runScreeningBatch', () => {
  it('一時障害を提案ごとに最大3回まで再試行する', async () => {
    const judge = vi
      .fn<(input: PendingLocalScreening) => Promise<LocalL3Result>>()
      .mockRejectedValueOnce(new Error('temporary 1'))
      .mockRejectedValueOnce(new Error('temporary 2'))
      .mockResolvedValue(verdict);
    const record = vi.fn().mockResolvedValue({
      status: 'recorded',
      checkId: 1,
      result: { finalVerdict: 'pass' },
    });

    await expect(
      runScreeningBatch({
        items: [item('proposal-1')],
        attempts: 3,
        judge,
        record,
      }),
    ).resolves.toEqual({ processed: 1, failed: 0 });
    expect(judge).toHaveBeenCalledTimes(3);
    expect(record).toHaveBeenCalledOnce();
  });

  it('3回失敗した提案を残し、後続提案の処理を続ける', async () => {
    const judge = vi.fn(
      async (input: PendingLocalScreening): Promise<LocalL3Result> => {
        if (input.proposal.id === 'broken') throw new Error('unavailable');
        return verdict;
      },
    );
    const record = vi.fn().mockResolvedValue({
      status: 'recorded',
      checkId: 2,
      result: { finalVerdict: 'pass' },
    });
    const events = vi.fn();

    await expect(
      runScreeningBatch({
        items: [item('broken'), item('healthy')],
        attempts: 3,
        judge,
        record,
        onEvent: events,
      }),
    ).resolves.toEqual({ processed: 1, failed: 1 });
    expect(judge).toHaveBeenCalledTimes(4);
    expect(record).toHaveBeenCalledOnce();
    expect(events).toHaveBeenCalledWith(
      expect.objectContaining({
        proposalId: 'broken',
        status: 'failed',
        attempt: 3,
      }),
    );
  });
});
