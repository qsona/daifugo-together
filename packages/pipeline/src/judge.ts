import { runJudgeFlow } from './judge-flow.js';

await runJudgeFlow(process.argv.includes('--review'), {
  judge: async () => {
    await import('./judge-run.js');
  },
  review: async () => {
    await import('./review-cli.js');
  },
});
