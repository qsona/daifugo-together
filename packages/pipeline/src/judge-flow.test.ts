import { describe, expect, it, vi } from 'vitest';

import { runJudgeFlow } from './judge-flow.js';

describe('judge command flow', () => {
  it('judge:reviewは判定後にレビューを開始する', async () => {
    const calls: string[] = [];

    await runJudgeFlow(true, {
      judge: async () => {
        calls.push('judge');
      },
      review: async () => {
        calls.push('review');
      },
    });

    expect(calls).toEqual(['judge', 'review']);
  });

  it('judgeはレビューを開始しない', async () => {
    const judge = vi.fn(async () => undefined);
    const review = vi.fn(async () => undefined);

    await runJudgeFlow(false, { judge, review });

    expect(judge).toHaveBeenCalledOnce();
    expect(review).not.toHaveBeenCalled();
  });

  it('判定が失敗した場合はレビューを開始しない', async () => {
    const review = vi.fn(async () => undefined);

    await expect(
      runJudgeFlow(true, {
        judge: async () => {
          throw new Error('judge failed');
        },
        review,
      }),
    ).rejects.toThrow('judge failed');

    expect(review).not.toHaveBeenCalled();
  });
});
