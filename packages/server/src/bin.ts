import { resolve } from 'node:path';

import { createAppServer } from './app-server.js';
import { SqlitePersistence } from './persistence.js';
import { RoomManager } from './room/manager.js';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
  throw new Error('PORT must be an integer between 0 and 65535');
}

const persistence = new SqlitePersistence(
  resolve(process.env.DATABASE_PATH ?? 'data/daifugo.sqlite'),
);
const app = createAppServer({
  webDistDir: resolve(process.env.WEB_DIST_DIR ?? 'packages/web/dist'),
  gateway: {
    rooms: new RoomManager(persistence.roomManagerOptions()),
    sessions: persistence.sessions,
  },
});
const actualPort = await app.listen(port);
process.stdout.write(`daifugo server listening on ${String(actualPort)}\n`);

let shuttingDown = false;
const shutdown = async (): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await app.beginDrain();
    await app.close();
    persistence.close();
    process.exitCode = 0;
  } catch (error) {
    process.stderr.write(
      `graceful shutdown failed: ${
        error instanceof Error ? error.stack : String(error)
      }\n`,
    );
    process.exitCode = 1;
  }
};

process.once('SIGTERM', () => {
  void shutdown();
});
process.once('SIGINT', () => {
  void shutdown();
});
