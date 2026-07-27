import type {
  AiJudgementResult,
  PendingCxJudgement,
  PipelineMutationResult,
} from '@daifugo/server';

export interface CxBatchEvent {
  proposalId: string;
  status: 'recorded' | 'already_recorded' | 'retrying' | 'failed';
  attempt: number;
  result?: Extract<
    PipelineMutationResult,
    { status: 'recorded' | 'already_recorded' }
  >;
  error?: unknown;
}

export interface CxBatchSummary {
  processed: number;
  recorded: number;
  alreadyRecorded: number;
  failed: number;
}

function invalidOutput(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes('invalid structured output') ||
      error.message.includes('non-JSON output'))
  );
}

export async function runCxJudgementBatch(options: {
  items: readonly PendingCxJudgement[];
  attempts: number;
  judge: (item: PendingCxJudgement) => Promise<AiJudgementResult>;
  record: (
    item: PendingCxJudgement,
    judgement: AiJudgementResult,
    runId: string,
  ) => Promise<PipelineMutationResult>;
  createRunId: () => string;
  onEvent?: (event: CxBatchEvent) => void;
}): Promise<CxBatchSummary> {
  const summary: CxBatchSummary = {
    processed: options.items.length,
    recorded: 0,
    alreadyRecorded: 0,
    failed: 0,
  };
  for (const item of options.items) {
    const runId = options.createRunId();
    let completed = false;
    for (
      let attempt = 1;
      attempt <= options.attempts && !completed;
      attempt += 1
    ) {
      try {
        const judgement = await options.judge(item);
        const result = await options.record(item, judgement, runId);
        if (
          result.status !== 'recorded' &&
          result.status !== 'already_recorded'
        ) {
          throw new Error(`CX-01 record failed: ${result.status}`);
        }
        if (result.status === 'recorded') summary.recorded += 1;
        else summary.alreadyRecorded += 1;
        options.onEvent?.({
          proposalId: item.proposal.id,
          status: result.status,
          attempt,
          result,
        });
        completed = true;
      } catch (error) {
        const finalAttempt =
          attempt >= options.attempts ||
          (invalidOutput(error) && attempt >= Math.min(2, options.attempts));
        options.onEvent?.({
          proposalId: item.proposal.id,
          status: finalAttempt ? 'failed' : 'retrying',
          attempt,
          error,
        });
        if (finalAttempt) {
          summary.failed += 1;
          completed = true;
        }
      }
    }
  }
  return summary;
}
