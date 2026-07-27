export type PipelineQueueStage = 'e6' | 'cx01' | 'confirmation';

export function selectPipelineWork<T extends { stage: PipelineQueueStage }>(
  items: readonly T[],
  limit: number,
): {
  actionable: T[];
  confirmations: T[];
} {
  return {
    actionable: items
      .filter(({ stage }) => stage === 'e6' || stage === 'cx01')
      .slice(0, limit),
    confirmations: items.filter(({ stage }) => stage === 'confirmation'),
  };
}
