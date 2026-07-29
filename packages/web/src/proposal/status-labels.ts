import type { ProposalStatus } from '@daifugo/core';

export const STATUS_LABELS: Record<ProposalStatus, string> = {
  screening: '確認中',
  implementing: '開発中',
  released: 'あそべる',
  rejected: '見送り',
  failed: '開発できず',
};
