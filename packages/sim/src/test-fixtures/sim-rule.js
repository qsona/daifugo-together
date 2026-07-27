export const rule = {
  meta: {
    ruleId: 'r9001-sim-worker',
    name: 'AI simulation fixture',
    description: 'Exercises the worker-side rule runtime',
    kind: 'original',
    proposalId: 'proposal-r9001-sim-worker',
    contractVersion: 1,
    messages: {},
  },
  hooks: {
    modifyStrength: (_context, base) => ({
      ranking: [...base.ranking].reverse(),
    }),
  },
};
