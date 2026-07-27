import { describe, expect, it } from 'vitest';

import { selectPipelineWork } from './queue-selection.js';

describe('pipeline queue selection', () => {
  it('確認待ちがlimitを消費せず、後方のE6/CX-01を処理対象にする', () => {
    const confirmations = Array.from({ length: 101 }, (_, index) => ({
      stage: 'confirmation' as const,
      id: `confirmation-${String(index)}`,
    }));
    const items = [
      ...confirmations,
      { stage: 'e6' as const, id: 'e6-new' },
      { stage: 'cx01' as const, id: 'cx01-new' },
    ];

    expect(selectPipelineWork(items, 2)).toEqual({
      actionable: [
        { stage: 'e6', id: 'e6-new' },
        { stage: 'cx01', id: 'cx01-new' },
      ],
      confirmations,
    });
  });
});
