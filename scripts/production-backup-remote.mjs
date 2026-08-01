import { createRequire } from 'node:module';
import { createReadStream, statSync, unlinkSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';

const require = createRequire('/app/packages/server/package.json');
const Database = require('better-sqlite3');

const source = '/data/daifugo.sqlite';
const snapshot = `/data/daifugo.sqlite.snapshot-${String(process.pid)}`;
const database = new Database(source, { readonly: true, fileMustExist: true });

try {
  database.exec(`VACUUM INTO '${snapshot.replaceAll("'", "''")}'`);
} finally {
  database.close();
}

process.stderr.write(`SNAPSHOT_BYTES=${String(statSync(snapshot).size)}\n`);

try {
  await pipeline(
    createReadStream(snapshot, { highWaterMark: 3 * 16_384 }),
    async function* encodeBase64(sourceChunks) {
      for await (const chunk of sourceChunks) {
        yield `BASE64:${chunk.toString('base64')}\n`;
      }
    },
    process.stdout,
  );
} finally {
  unlinkSync(snapshot);
}
