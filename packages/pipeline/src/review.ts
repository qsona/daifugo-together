import type {
  PendingVerdictConfirmation,
  RuleSpecification,
} from '@daifugo/server';

import type { ConfirmationCommand } from './confirmation.js';

export const MANUAL_REJECTION_REASONS = [
  {
    key: '1',
    category: 'contract',
    label: '今のしくみでは開発できない',
    reasonForUser: '今のしくみでは開発できませんでした。',
  },
  {
    key: '2',
    category: 'game_breaking',
    label: 'ゲームが成り立たなくなる',
    reasonForUser: 'ゲームが成り立たなくなるため、開発できませんでした。',
  },
  {
    key: '3',
    category: 'inappropriate',
    label: '安全に扱えない内容が含まれている',
    reasonForUser: '安全に扱えない内容が含まれていました。',
  },
  {
    key: '4',
    category: 'duplicate',
    label: '既存のルールと重複している',
    reasonForUser: '似たルールが既にあります。',
  },
  {
    key: '5',
    category: 'unintelligible',
    label: 'ルールとして解釈できない',
    reasonForUser: 'ルールとして解釈できませんでした。',
  },
  {
    key: '6',
    category: 'other',
    label: 'その他（理由を入力）',
    reasonForUser: null,
  },
] as const;

export type ManualRejectionReason = (typeof MANUAL_REJECTION_REASONS)[number];

function indent(value: string): string {
  return value
    .split(/\r?\n/u)
    .map((line) => `  ${line}`)
    .join('\n');
}

function list(values: string[]): string {
  return values.length === 0 ? 'なし' : values.join(', ');
}

function percentage(value: number | null): string {
  return value === null ? '不明' : `${String(Math.round(value * 100))}%`;
}

function formatSpec(spec: RuleSpecification): string {
  return [
    `  名前: ${spec.name}`,
    `  要約: ${spec.summary}`,
    `  hooks: ${list(spec.hooks)}`,
    `  effects: ${list(spec.effects)}`,
    `  engineFeatures: ${list(spec.engineFeatures ?? [])}`,
    `  テスト観点: ${list(spec.testPoints)}`,
    `  備考: ${spec.notes || 'なし'}`,
  ].join('\n');
}

export function formatReviewItem(
  item: PendingVerdictConfirmation,
  index: number,
  total: number,
): string {
  const header = [
    `[${String(index)}/${String(total)}] ${item.proposal.name}`,
    `提案ID: ${item.proposal.id}`,
    '',
    '提案内容:',
    indent(item.proposal.body),
  ];

  if (item.source === 'e6') {
    return [
      ...header,
      '',
      `E6判定: ${item.check.finalVerdict}`,
      `LLM判定: ${item.check.llmVerdict}`,
      `要確認フラグ: ${item.check.reviewFlag ? 'あり' : 'なし'}`,
    ].join('\n');
  }

  const judgement = item.judgement;
  const details = [
    ...header,
    '',
    `AI判定: ${judgement.verdict.toUpperCase()}`,
    `確信度: ${percentage(judgement.confidence)}`,
    `ユーザー向け理由: ${judgement.reasonForUser ?? 'なし'}`,
    `内部判断理由: ${judgement.reasonInternal}`,
  ];
  if (judgement.rejectCategory !== null) {
    details.push(
      `却下区分: ${judgement.rejectCategory}${judgement.rejectSubtype === null ? '' : ` / ${judgement.rejectSubtype}`}`,
    );
  }
  if (judgement.spec !== null) {
    details.push('', '生成される仕様:', formatSpec(judgement.spec));
  }
  if (judgement.scaffoldMeta !== null) {
    details.push(`  slug: ${judgement.scaffoldMeta.slug}`);
  }
  if (judgement.extensionNeeded !== null) {
    details.push(
      '',
      '拡張要求:',
      `  機構タグ: ${list(judgement.extensionNeeded.capabilities)}`,
      `  スケッチ: ${judgement.extensionNeeded.sketch}`,
    );
  }
  return details.join('\n');
}

export function suggestedConfirmation(
  item: PendingVerdictConfirmation,
  actor: string,
): ConfirmationCommand | null {
  if (item.source === 'e6') {
    return {
      action: 'confirm_e6_rejection',
      proposalId: item.proposal.id,
      checkId: item.check.id,
      actor,
    };
  }
  const judgement = item.judgement;
  if (
    judgement.verdict === 'approve' &&
    judgement.spec !== null &&
    judgement.scaffoldMeta !== null
  ) {
    return {
      action: 'approve_spec',
      proposalId: item.proposal.id,
      judgementId: judgement.id,
      actor,
      spec: judgement.spec as unknown as Record<string, unknown>,
      scaffoldMeta: judgement.scaffoldMeta as unknown as Record<
        string,
        unknown
      >,
    };
  }
  if (judgement.verdict === 'reject') {
    return {
      action: 'confirm_rejection',
      proposalId: item.proposal.id,
      judgementId: judgement.id,
      actor,
      ...(judgement.rejectCategory === null
        ? {}
        : { rejectCategory: judgement.rejectCategory }),
      ...(judgement.rejectSubtype === null
        ? {}
        : { rejectSubtype: judgement.rejectSubtype }),
      ...(judgement.reasonForUser === null
        ? {}
        : { reasonForUser: judgement.reasonForUser }),
    };
  }
  return null;
}

export function editableConfirmation(
  item: PendingVerdictConfirmation,
  actor: string,
): Record<string, unknown> {
  const suggested = suggestedConfirmation(item, actor);
  if (suggested !== null) return suggested;
  if (item.source === 'cx01') {
    return {
      action: 'confirm_rejection',
      proposalId: item.proposal.id,
      judgementId: item.judgement.id,
      actor,
      rejectCategory: '',
      rejectSubtype: '',
      reasonForUser: '',
    };
  }
  throw new Error('unsupported confirmation item');
}

export function manualRejectionConfirmation(
  item: Extract<PendingVerdictConfirmation, { source: 'cx01' }>,
  actor: string,
  reason: ManualRejectionReason,
  customReason?: string,
): ConfirmationCommand | null {
  const reasonForUser = reason.reasonForUser ?? customReason?.trim();
  if (!reasonForUser) return null;
  return {
    action: 'confirm_rejection',
    proposalId: item.proposal.id,
    judgementId: item.judgement.id,
    actor,
    rejectCategory: reason.category,
    rejectSubtype: null,
    reasonForUser,
  };
}

export function validateConfirmationForItem(
  item: PendingVerdictConfirmation,
  command: ConfirmationCommand,
): string | null {
  if (command.proposalId !== item.proposal.id) {
    return 'proposalIdは変更できません';
  }
  if (item.source === 'e6') {
    if (
      command.action !== 'confirm_e6_rejection' ||
      command.checkId !== item.check.id
    ) {
      return 'E6確定ではactionとcheckIdを変更できません';
    }
    return null;
  }
  if (
    command.action === 'confirm_e6_rejection' ||
    command.judgementId !== item.judgement.id
  ) {
    return 'CX-01確定ではaction種別とjudgementIdを変更できません';
  }
  if (item.judgement.verdict === 'needs_review') {
    const isValidRejection =
      command.action === 'confirm_rejection' &&
      command.rejectCategory !== undefined &&
      command.reasonForUser !== undefined;
    const isValidApproval = command.action === 'approve_spec';
    if (!isValidRejection && !isValidApproval) {
      return 'needs_reviewの確定には、rejectCategoryとreasonForUserを指定したconfirm_rejection、またはapprove_specが必要です';
    }
  }
  return null;
}

export function extensionPendingSummary(
  items: readonly PendingVerdictConfirmation[],
): string | null {
  const groups = new Map<string, { id: string; name: string }[]>();
  for (const item of items) {
    if (item.source !== 'cx01') continue;
    const { judgement, proposal } = item;
    if (
      judgement.verdict !== 'needs_review' ||
      judgement.extensionNeeded === null
    ) {
      continue;
    }
    for (const capability of judgement.extensionNeeded.capabilities) {
      const entries = groups.get(capability) ?? [];
      entries.push({ id: proposal.id, name: proposal.name });
      groups.set(capability, entries);
    }
  }
  if (groups.size === 0) return null;
  return [...groups.entries()]
    .map(
      ([capability, entries]) =>
        `  ${capability} — ${entries
          .map(({ id, name }) => `${id} 「${name}」`)
          .join(', ')}`,
    )
    .join('\n');
}
