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
    jobs: new PipelineJobService(persistence.pipeline, () => ++now),
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
        ruleId: 'r0001',
        slug: 'yagiri',
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
      }),
    ).toMatchObject({
      status: 'updated',
      job: {
        phase: 'implementing',
        branch: 'rule/r0001-yagiri',
        scaffoldSha: 'a'.repeat(40),
      },
    });
    expect(jobs.next()).toBeNull();
    expect(
      jobs.update(item.job.id, {
        from: 'queued',
        to: 'implementing',
      }),
    ).toEqual({ status: 'conflict', error: 'stale_job_phase' });
    expect(persistence.pipeline.job(item.job.id)?.phase).toBe('implementing');
  });
});
