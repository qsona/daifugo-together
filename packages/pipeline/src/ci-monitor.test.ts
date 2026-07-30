import type { QueuedImplementation } from '@daifugo/server';
import { describe, expect, it } from 'vitest';

import { inspectImplementationCi } from './ci-monitor.js';
import type { ProcessPort } from './process.js';

const item = {
  job: {
    id: 1,
    proposalId: 'proposal-1',
    phase: 'pr_open',
    attempt: 1,
    implementationAttempt: 1,
    ciRerun: 0,
    ruleId: 'r0001-yagiri',
    slug: 'yagiri',
    branch: 'rule/r0001-yagiri',
    prNumber: 42,
    headSha: 'b'.repeat(40),
    mergeSha: null,
    scaffoldSha: 'a'.repeat(40),
    promptVersion: 'cx02-v3',
    errorCode: null,
    errorNote: null,
    createdAt: 1,
    updatedAt: 1,
  },
  proposal: {
    id: 'proposal-1',
    kind: 'local',
    prefectureCode: '11',
    prefecture: '埼玉県',
    name: '八切り',
    body: '8で流す',
  },
  passedCheckId: 2,
  approvedJudgementId: 3,
  spec: {
    specVersion: 1,
    name: '八切り',
    summary: '8で流す',
    hooks: ['afterPlay'],
    effects: ['clearField'],
    testPoints: ['fires'],
    notes: '',
    source: { kind: 'local', title: '八切り', body: '8で流す' },
  },
  scaffoldMeta: { slug: 'yagiri', messages: {} },
} satisfies QueuedImplementation;

describe('CX-03 CI monitor', () => {
  it('required checks greenを開発者review可能として返す', async () => {
    const process: ProcessPort = {
      run: async () => ({
        exitCode: 0,
        stdout: JSON.stringify([
          { name: 'diff-guard', bucket: 'pass', state: 'SUCCESS', link: '' },
          { name: 'quality', bucket: 'pass', state: 'SUCCESS', link: '' },
          { name: 'rule-tests', bucket: 'pass', state: 'SUCCESS', link: '' },
          { name: 'simulation', bucket: 'pass', state: 'SUCCESS', link: '' },
        ]),
        stderr: '',
        timedOut: false,
      }),
    };

    await expect(
      inspectImplementationCi({
        jobs: { resume: () => item },
        process,
        jobId: 1,
        cwd: '/repo',
      }),
    ).resolves.toMatchObject({ status: 'green', failedLogExcerpt: [] });
  });

  it('required checkの欠落や重複をgreenにしない', async () => {
    const process: ProcessPort = {
      run: async () => ({
        exitCode: 0,
        stdout: JSON.stringify([
          { name: 'diff-guard', bucket: 'pass', state: 'SUCCESS', link: '' },
          { name: 'quality', bucket: 'pass', state: 'SUCCESS', link: '' },
          { name: 'quality', bucket: 'pass', state: 'SUCCESS', link: '' },
          { name: 'rule-tests', bucket: 'pass', state: 'SUCCESS', link: '' },
        ]),
        stderr: '',
        timedOut: false,
      }),
    };

    await expect(
      inspectImplementationCi({
        jobs: { resume: () => item },
        process,
        jobId: 1,
        cwd: '/repo',
      }),
    ).resolves.toMatchObject({ status: 'pending' });
  });

  it('失敗jobのログを先頭100行に制限する', async () => {
    let call = 0;
    const process: ProcessPort = {
      run: async () => {
        call += 1;
        return call === 1
          ? {
              exitCode: 0,
              stdout: JSON.stringify([
                {
                  name: 'simulation',
                  bucket: 'fail',
                  state: 'FAILURE',
                  link: 'https://github.test/actions/runs/123/job/456',
                },
              ]),
              stderr: '',
              timedOut: false,
            }
          : {
              exitCode: 0,
              stdout: Array.from({ length: 150 }, (_, index) =>
                String(index),
              ).join('\n'),
              stderr: '',
              timedOut: false,
            };
      },
    };

    const inspection = await inspectImplementationCi({
      jobs: { resume: () => item },
      process,
      jobId: 1,
      cwd: '/repo',
    });
    expect(inspection.status).toBe('failed');
    expect(inspection.failedLogExcerpt).toHaveLength(100);
  });
});
