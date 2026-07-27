import type {
  LocalL3Result,
  PendingLocalScreening,
  RecordLocalVerdictResult,
} from './local-screening.js';

export interface ScreeningBatchEvent {
  proposalId: string;
  status: 'recorded' | 'already_recorded' | 'failed';
  attempt: number;
  result?: RecordLocalVerdictResult;
  error?: unknown;
}

export async function runScreeningBatch(options: {
  items: readonly PendingLocalScreening[];
  attempts: number;
  judge: (item: PendingLocalScreening) => Promise<LocalL3Result>;
  record: (
    item: PendingLocalScreening,
    verdict: LocalL3Result,
  ) => Promise<RecordLocalVerdictResult>;
  onEvent?: (event: ScreeningBatchEvent) => void;
}): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;
  for (const item of options.items) {
    let verdict: LocalL3Result | undefined;
    let lastError: unknown;
    let usedAttempt = 0;
    for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
      usedAttempt = attempt;
      try {
        verdict = await options.judge(item);
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!verdict) {
      failed += 1;
      options.onEvent?.({
        proposalId: item.proposal.id,
        status: 'failed',
        attempt: options.attempts,
        error: lastError,
      });
      continue;
    }
    try {
      const result = await options.record(item, verdict);
      if (
        result.status !== 'recorded' &&
        result.status !== 'already_recorded'
      ) {
        throw new Error(
          `proposal ${item.proposal.id} was not recorded: ${result.status}`,
        );
      }
      processed += 1;
      options.onEvent?.({
        proposalId: item.proposal.id,
        status: result.status,
        attempt: usedAttempt,
        result,
      });
    } catch (error) {
      failed += 1;
      options.onEvent?.({
        proposalId: item.proposal.id,
        status: 'failed',
        attempt: usedAttempt,
        error,
      });
    }
  }
  return { processed, failed };
}
