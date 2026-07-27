export const rule = {
  meta: {
    ruleId: 'r9000-ai-follow',
    name: 'AI追従fixture',
    description: '全てのプレイを通知してworkerのルール実行経路を確認する',
    kind: 'original',
    proposalId: 'ai02-fixture',
    contractVersion: 1,
    messages: {
      fired: 'AI追従fixture',
    },
  },
  hooks: {
    afterPlay: () => [{ type: 'announce', messageKey: 'fired' }],
  },
};
