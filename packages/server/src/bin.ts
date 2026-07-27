import { resolve } from 'node:path';

import { createAppServer } from './app-server.js';
import { InjectionStaticAnalyzer } from './injection/detector.js';
import { LocalScreeningService } from './injection/local-screening.js';
import { InjectionSignalRecorder } from './injection/screening.js';
import { YellowCardService } from './injection/yellow-card-service.js';
import { PipelineJudgementService } from './pipeline/service.js';
import { PipelineJobService } from './pipeline/jobs.js';
import { SqlitePersistence } from './persistence.js';
import { ProposalSubmissionService } from './proposal/submission.js';
import { RoomManager } from './room/manager.js';

function errorFields(error: unknown): Record<string, unknown> {
  return error instanceof Error
    ? { error: error.message, stack: error.stack }
    : { error: String(error) };
}

function writeLog(
  level: 'info' | 'error',
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const line = `${JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields,
  })}\n`;
  (level === 'error' ? process.stderr : process.stdout).write(line);
}

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
  throw new Error('PORT must be an integer between 0 and 65535');
}

const persistence = new SqlitePersistence(
  resolve(process.env.DATABASE_PATH ?? 'data/daifugo.sqlite'),
);
const signals = new InjectionSignalRecorder(
  new InjectionStaticAnalyzer(),
  persistence.injection,
);
const adminPipelineToken = process.env.ADMIN_PIPELINE_TOKEN;
if (adminPipelineToken !== undefined && adminPipelineToken.length < 32) {
  throw new Error('ADMIN_PIPELINE_TOKEN must be at least 32 characters');
}
const app = createAppServer({
  webDistDir: resolve(process.env.WEB_DIST_DIR ?? 'packages/web/dist'),
  checkDatabase: () => persistence.checkHealth(),
  proposals: new ProposalSubmissionService(persistence.proposals, {
    signals,
  }),
  yellowCards: new YellowCardService(
    persistence.injection,
    persistence.proposals,
  ),
  ...(adminPipelineToken
    ? {
        adminScreening: {
          token: adminPipelineToken,
          service: new LocalScreeningService(
            persistence.injection,
            persistence.proposals,
          ),
        },
        adminPipeline: {
          token: adminPipelineToken,
          service: new PipelineJudgementService(
            persistence.pipeline,
            persistence.proposals,
            persistence.injection,
          ),
          jobs: new PipelineJobService(persistence.pipeline),
        },
      }
    : {}),
  gateway: {
    rooms: new RoomManager(persistence.roomManagerOptions()),
    sessions: persistence.sessions,
    onError: (error) => {
      writeLog('error', 'socket_internal_error', errorFields(error));
    },
    onAiLog: (log) => {
      if (log.fallback !== 'none') {
        writeLog('info', 'ai_fallback', { ...log });
      }
    },
  },
});
const actualPort = await app.listen(port);
writeLog('info', 'server_listening', { port: actualPort });

let shuttingDown = false;
const shutdown = async (): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  writeLog('info', 'server_drain_started');
  try {
    await app.beginDrain();
    await app.close();
    persistence.close();
    writeLog('info', 'server_drain_completed');
    process.exitCode = 0;
  } catch (error) {
    writeLog('error', 'server_drain_failed', errorFields(error));
    process.exitCode = 1;
  }
};

process.on('uncaughtExceptionMonitor', (error, origin) => {
  writeLog('error', 'uncaught_exception', {
    origin,
    ...errorFields(error),
  });
});

process.once('SIGTERM', () => {
  void shutdown();
});
process.once('SIGINT', () => {
  void shutdown();
});
