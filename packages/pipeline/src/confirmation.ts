type JsonObject = Record<string, unknown>;

export type ConfirmationCommand =
  | {
      action: 'confirm_e6_rejection';
      proposalId: string;
      checkId: number;
      actor: string;
    }
  | {
      action: 'confirm_rejection';
      proposalId: string;
      judgementId: number;
      actor: string;
      rejectCategory?: string;
      rejectSubtype?: string | null;
      reasonForUser?: string;
    }
  | {
      action: 'approve_spec';
      proposalId: string;
      judgementId: number;
      actor: string;
      spec: JsonObject;
      scaffoldMeta: JsonObject;
    }
  | {
      action: 'amend_spec';
      proposalId: string;
      jobId: number;
      judgementId: number;
      actor: string;
      spec: JsonObject;
      scaffoldMeta: JsonObject;
    };

export interface AdminMutationRequest {
  path: string;
  body: JsonObject;
}

function object(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function positiveId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

export function parseConfirmationCommand(
  value: unknown,
): ConfirmationCommand | null {
  const input = object(value);
  if (!input || !nonempty(input.proposalId) || !nonempty(input.actor)) {
    return null;
  }
  if (input.action === 'confirm_e6_rejection' && positiveId(input.checkId)) {
    return {
      action: input.action,
      proposalId: input.proposalId,
      checkId: input.checkId,
      actor: input.actor,
    };
  }
  if (input.action === 'confirm_rejection' && positiveId(input.judgementId)) {
    return {
      action: input.action,
      proposalId: input.proposalId,
      judgementId: input.judgementId,
      actor: input.actor,
      ...(nonempty(input.rejectCategory)
        ? { rejectCategory: input.rejectCategory }
        : {}),
      ...(input.rejectSubtype === null || nonempty(input.rejectSubtype)
        ? { rejectSubtype: input.rejectSubtype }
        : {}),
      ...(nonempty(input.reasonForUser)
        ? { reasonForUser: input.reasonForUser }
        : {}),
    };
  }
  const spec = object(input.spec);
  const scaffoldMeta = object(input.scaffoldMeta);
  if (
    input.action === 'approve_spec' &&
    positiveId(input.judgementId) &&
    spec &&
    scaffoldMeta
  ) {
    return {
      action: input.action,
      proposalId: input.proposalId,
      judgementId: input.judgementId,
      actor: input.actor,
      spec,
      scaffoldMeta,
    };
  }
  if (
    input.action === 'amend_spec' &&
    positiveId(input.jobId) &&
    positiveId(input.judgementId) &&
    spec &&
    scaffoldMeta
  ) {
    return {
      action: input.action,
      proposalId: input.proposalId,
      jobId: input.jobId,
      judgementId: input.judgementId,
      actor: input.actor,
      spec,
      scaffoldMeta,
    };
  }
  return null;
}

export function confirmationRequest(
  command: ConfirmationCommand,
): AdminMutationRequest {
  const proposalId = encodeURIComponent(command.proposalId);
  if (command.action === 'amend_spec') {
    return {
      path: `/admin/proposals/${proposalId}/amend-spec`,
      body: {
        jobId: command.jobId,
        judgementId: command.judgementId,
        actor: command.actor,
        spec: command.spec,
        scaffoldMeta: command.scaffoldMeta,
      },
    };
  }
  if (command.action === 'approve_spec') {
    return {
      path: `/admin/proposals/${proposalId}/approve-spec`,
      body: {
        judgementId: command.judgementId,
        actor: command.actor,
        spec: command.spec,
        scaffoldMeta: command.scaffoldMeta,
      },
    };
  }
  if (command.action === 'confirm_e6_rejection') {
    return {
      path: `/admin/proposals/${proposalId}/judge`,
      body: {
        action: command.action,
        payload: { checkId: command.checkId, actor: command.actor },
      },
    };
  }
  return {
    path: `/admin/proposals/${proposalId}/judge`,
    body: {
      action: command.action,
      payload: {
        judgementId: command.judgementId,
        actor: command.actor,
        ...(command.rejectCategory === undefined
          ? {}
          : { rejectCategory: command.rejectCategory }),
        ...(command.rejectSubtype === undefined
          ? {}
          : { rejectSubtype: command.rejectSubtype }),
        ...(command.reasonForUser === undefined
          ? {}
          : { reasonForUser: command.reasonForUser }),
      },
    },
  };
}
