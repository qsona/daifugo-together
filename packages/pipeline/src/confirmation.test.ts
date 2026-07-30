import { describe, expect, it } from 'vitest';

import {
  confirmationRequest,
  parseConfirmationCommand,
} from './confirmation.js';

describe('developer verdict confirmation command', () => {
  it('E6 check IDを固定した却下確定リクエストを作る', () => {
    const command = parseConfirmationCommand({
      action: 'confirm_e6_rejection',
      proposalId: 'proposal/1',
      checkId: 7,
      actor: 'developer@example.test',
    });
    expect(command).not.toBeNull();
    expect(confirmationRequest(command!)).toEqual({
      path: '/admin/proposals/proposal%2F1/judge',
      body: {
        action: 'confirm_e6_rejection',
        payload: { checkId: 7, actor: 'developer@example.test' },
      },
    });
  });

  it('needs_reviewの人手却下理由を欠落させず送る', () => {
    const command = parseConfirmationCommand({
      action: 'confirm_rejection',
      proposalId: 'proposal-2',
      judgementId: 11,
      actor: 'developer',
      rejectCategory: 'contract',
      rejectSubtype: 'A2',
      reasonForUser: '現在の仕組みには必要な状態がありません。',
    });
    expect(confirmationRequest(command!)).toMatchObject({
      body: {
        action: 'confirm_rejection',
        payload: {
          judgementId: 11,
          rejectCategory: 'contract',
          rejectSubtype: 'A2',
        },
      },
    });
  });

  it('SPECとscaffold metaを分離して承認APIへ送る', () => {
    const command = parseConfirmationCommand({
      action: 'approve_spec',
      proposalId: 'proposal-3',
      judgementId: 12,
      actor: 'developer',
      spec: { specVersion: 1, name: '八切り' },
      scaffoldMeta: { slug: 'yagiri', messages: {} },
    });
    expect(confirmationRequest(command!)).toEqual({
      path: '/admin/proposals/proposal-3/approve-spec',
      body: {
        judgementId: 12,
        actor: 'developer',
        spec: { specVersion: 1, name: '八切り' },
        scaffoldMeta: { slug: 'yagiri', messages: {} },
      },
    });
  });

  it('レビュー前のSPEC改訂をjobと承認judgementに固定して送る', () => {
    const command = parseConfirmationCommand({
      action: 'amend_spec',
      proposalId: 'proposal-3',
      jobId: 6,
      judgementId: 12,
      actor: 'developer',
      spec: { specVersion: 1, name: '縛り' },
      scaffoldMeta: { slug: 'shibari', messages: {} },
    });
    expect(confirmationRequest(command!)).toEqual({
      path: '/admin/proposals/proposal-3/amend-spec',
      body: {
        jobId: 6,
        judgementId: 12,
        actor: 'developer',
        spec: { specVersion: 1, name: '縛り' },
        scaffoldMeta: { slug: 'shibari', messages: {} },
      },
    });
  });

  it('対象IDやactorが欠けた入力を拒否する', () => {
    expect(
      parseConfirmationCommand({
        action: 'confirm_rejection',
        proposalId: 'proposal-4',
        judgementId: 0,
        actor: '',
      }),
    ).toBeNull();
  });
});
