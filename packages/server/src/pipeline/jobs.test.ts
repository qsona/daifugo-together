import { afterEach, describe, expect, it } from 'vitest';

import { InjectionStaticAnalyzer } from '../injection/detector.js';
import { LocalScreeningService } from '../injection/local-screening.js';
import { InjectionSignalRecorder } from '../injection/screening.js';
import { SqlitePersistence } from '../persistence.js';
import { ProposalSubmissionService } from '../proposal/submission.js';
import { PipelineJobService } from './jobs.js';
import { PipelineJudgementService } from './service.js';

const instances: SqlitePersistence[] = [];

afterEach(() => {
  for (const instance of instances.splice(0)) instance.close();
});

async function approvedProposal() {
  let now = 1_000;
  const persistence = new SqlitePersistence(':memory:', {
    createUserId: () => 'pipeline-user',
    createToken: () => 'pipeline-token-0001',
  });
  instances.push(persistence);
  persistence.sessions.resolve(undefined);
  const submissions = new ProposalSubmissionService(persistence.proposals, {
    signals: new InjectionSignalRecorder(
      new InjectionStaticAnalyzer(),
      persistence.injection,
      () => now,
    ),
    now: () => now,
    createId: () => 'PIPELINE-JOB-1',
  });
  const submitted = await submissions.submit({
    token: 'pipeline-token-0001',
    ip: '127.0.0.1',
    body: {
      kind: 'local',
      prefectureCode: '11',
      name: '八切り',
      body: '8を含むカードを出したら場を流す。',
    },
  });
  if (submitted.status !== 200) throw new Error('proposal setup failed');
  const proposal = submitted.body.proposal;
  const local = new LocalScreeningService(
    persistence.injection,
    persistence.proposals,
    () => ++now,
  );
  local.record(proposal.id, {
    verdict: 'clean',
    reason: '通常の大富豪ルール提案',
    evidence: null,
    model: 'gpt-5.6-sol',
    latencyMs: 5,
  });
  const judgements = new PipelineJudgementService(
    persistence.pipeline,
    persistence.proposals,
    persistence.injection,
    () => ++now,
  );
  const ai = judgements.recordAi(proposal.id, {
    verdict: 'approve',
    rejectCategory: null,
    rejectSubtype: null,
    reasonForUser: null,
    reasonInternal: '契約v1で実装可能。',
    spec: {
      specVersion: 1,
      name: '八切り',
      summary: '8を含むプレイの直後に場を流す。',
      hooks: ['afterPlay'],
      effects: ['clearField'],
      testPoints: ['8で発動する', '8以外では発動しない'],
      notes: '',
    },
    scaffoldMeta: {
      slug: 'yagiri',
      messages: { fired: '八切り！場が流れます' },
    },
    confidence: 0.95,
    model: 'gpt-5.6-sol',
    promptVersion: 'cx01-v1',
    latencyMs: 10,
    runId: 'run-1',
  });
  if (ai.status !== 'recorded') throw new Error('AI judgement setup failed');
  const approved = judgements.approveSpec(proposal.id, {
    judgementId: ai.judgement.id,
    actor: 'developer@example.test',
    spec: {
      specVersion: 1,
      name: '八切り',
      summary: '8を含むプレイの直後に場を流す。',
      hooks: ['afterPlay'],
      effects: ['clearField'],
      testPoints: ['8で発動する', '8以外では発動しない'],
      notes: '',
    },
    scaffoldMeta: {
      slug: 'yagiri',
      messages: { fired: '八切り！場が流れます' },
    },
  });
  if (approved.status !== 'confirmed') {
    throw new Error('developer approval setup failed');
  }
  return {
    jobs: new PipelineJobService(
      persistence.pipeline,
      persistence.proposals,
      () => ++now,
    ),
    persistence,
    proposal,
  };
}

describe('CX-02 pipeline jobs', () => {
  it('E6 passと開発者SPEC承認済みのqueued jobだけを払い出す', async () => {
    const { jobs, proposal } = await approvedProposal();

    expect(jobs.next()).toMatchObject({
      job: {
        proposalId: proposal.id,
        phase: 'queued',
        ruleId: 'r0001-yagiri',
        slug: 'yagiri',
        promptVersion: null,
      },
      proposal: {
        id: proposal.id,
        prefectureCode: '11',
        prefecture: '埼玉県',
      },
      spec: {
        source: {
          kind: 'local',
          title: '八切り',
          body: '8を含むカードを出したら場を流す。',
        },
      },
      scaffoldMeta: {
        slug: 'yagiri',
        messages: { fired: '八切り！場が流れます' },
      },
    });
  });

  it('phaseをcompare-and-setで進め、同じqueued jobの二重取得を止める', async () => {
    const { jobs, persistence } = await approvedProposal();
    const item = jobs.next();
    if (!item) throw new Error('queued job missing');

    expect(
      jobs.update(item.job.id, {
        from: 'queued',
        to: 'implementing',
        branch: 'rule/r0001-yagiri',
        scaffoldSha: 'a'.repeat(40),
        promptVersion: 'cx02-v3',
      }),
    ).toMatchObject({
      status: 'updated',
      job: {
        phase: 'implementing',
        branch: 'rule/r0001-yagiri',
        scaffoldSha: 'a'.repeat(40),
        promptVersion: 'cx02-v3',
      },
    });
    expect(jobs.next()).toBeNull();
    expect(jobs.resume(item.job.id)).toMatchObject({
      job: { phase: 'implementing', scaffoldSha: 'a'.repeat(40) },
      passedCheckId: expect.any(Number),
      approvedJudgementId: expect.any(Number),
    });
    expect(jobs.active()).toEqual([
      expect.objectContaining({ id: item.job.id, phase: 'implementing' }),
    ]);
    expect(
      jobs.update(item.job.id, {
        from: 'implementing',
        to: 'pr_open',
      }),
    ).toEqual({
      status: 'invalid',
      error: 'missing_job_transition_fields',
    });
    expect(
      jobs.update(item.job.id, {
        from: 'implementing',
        to: 'pr_open',
        prNumber: 42,
        headSha: 'b'.repeat(40),
      }),
    ).toMatchObject({
      status: 'updated',
      job: {
        phase: 'pr_open',
        prNumber: 42,
        headSha: 'b'.repeat(40),
      },
    });
    expect(
      jobs.update(item.job.id, {
        from: 'queued',
        to: 'implementing',
      }),
    ).toEqual({ status: 'conflict', error: 'stale_job_phase' });
    expect(persistence.pipeline.job(item.job.id)?.phase).toBe('pr_open');
  });

  it('遷移に必要な固定点を欠く更新を拒否する', async () => {
    const { jobs, persistence } = await approvedProposal();
    const item = jobs.next();
    if (!item) throw new Error('queued job missing');

    expect(
      jobs.update(item.job.id, {
        from: 'queued',
        to: 'implementing',
        branch: 'rule/wrong',
        scaffoldSha: 'a'.repeat(40),
        promptVersion: 'cx02-v3',
      }),
    ).toEqual({
      status: 'invalid',
      error: 'missing_job_transition_fields',
    });
    expect(persistence.pipeline.job(item.job.id)?.phase).toBe('queued');
  });

  it('内部失敗区分とユーザー向けimplementation_failedを同時に確定する', async () => {
    const { jobs, persistence, proposal } = await approvedProposal();
    const item = jobs.next();
    if (!item) throw new Error('queued job missing');
    jobs.update(item.job.id, {
      from: 'queued',
      to: 'implementing',
      branch: 'rule/r0001-yagiri',
      scaffoldSha: 'a'.repeat(40),
      promptVersion: 'cx02-v3',
    });

    expect(
      jobs.fail(item.job.id, {
        from: 'implementing',
        errorCode: 'inspect_violation',
        errorNote: 'SPEC.json changed',
      }),
    ).toMatchObject({
      status: 'failed',
      job: {
        phase: 'failed',
        errorCode: 'inspect_violation',
        errorNote: 'SPEC.json changed',
      },
    });
    expect(persistence.proposals.findById(proposal.id)).toMatchObject({
      status: 'failed',
      reasonCode: 'implementation_failed',
      attemptCount: 1,
    });
    expect(
      jobs.fail(item.job.id, {
        from: 'implementing',
        errorCode: 'inspect_violation',
      }),
    ).toMatchObject({ status: 'already_failed' });
  });

  it('開発者が明示した1回だけattempt 2へ進め、-a2固定点を要求する', async () => {
    const { jobs } = await approvedProposal();
    const item = jobs.next();
    if (!item) throw new Error('queued job missing');
    jobs.update(item.job.id, {
      from: 'queued',
      to: 'implementing',
      branch: 'rule/r0001-yagiri',
      scaffoldSha: 'a'.repeat(40),
      promptVersion: 'cx02-v3',
    });

    expect(
      jobs.retry(item.job.id, {
        from: 'implementing',
        expectedAttempt: 1,
      }),
    ).toMatchObject({
      status: 'retried',
      job: {
        phase: 'implementing',
        attempt: 2,
        branch: null,
        scaffoldSha: null,
      },
    });
    expect(
      jobs.update(item.job.id, {
        from: 'implementing',
        to: 'implementing',
        branch: 'rule/r0001-yagiri',
        scaffoldSha: 'b'.repeat(40),
        promptVersion: 'cx02-v3',
      }),
    ).toEqual({
      status: 'invalid',
      error: 'missing_job_transition_fields',
    });
    expect(
      jobs.update(item.job.id, {
        from: 'implementing',
        to: 'implementing',
        branch: 'rule/r0001-yagiri-a2',
        scaffoldSha: 'b'.repeat(40),
        promptVersion: 'cx02-v3',
      }),
    ).toMatchObject({
      status: 'updated',
      job: { attempt: 2, branch: 'rule/r0001-yagiri-a2' },
    });
    expect(
      jobs.retry(item.job.id, {
        from: 'implementing',
        expectedAttempt: 2,
      }),
    ).toEqual({ status: 'invalid', error: 'invalid_job_retry' });
  });
});
