export type PipelineQueueStage = 'e6' | 'cx01' | 'confirmation';

export function scopePipelineItemsByProposalId<
  T extends { proposal: { id: string } },
>(items: readonly T[], proposalId: string | null): T[] {
  return proposalId === null
    ? [...items]
    : items.filter((item) => item.proposal.id === proposalId);
}

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
