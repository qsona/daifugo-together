import { inspectImplementationCi } from './ci-monitor.js';
import { HttpPipelineJobPort } from './implementation-api.js';
import { SpawnProcessPort } from './process.js';

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const jobId = Number(process.argv[2]);
if (!Number.isSafeInteger(jobId) || jobId <= 0) {
  throw new Error('usage: ci-cli JOB_ID');
}
const inspection = await inspectImplementationCi({
  jobs: new HttpPipelineJobPort({
    baseUrl: requiredEnvironment('ADMIN_PIPELINE_URL'),
    token: requiredEnvironment('ADMIN_PIPELINE_TOKEN'),
  }),
  process: new SpawnProcessPort(),
  jobId,
  cwd: process.cwd(),
});
process.stdout.write(`${JSON.stringify(inspection)}\n`);
if (inspection.status === 'failed') process.exitCode = 1;
