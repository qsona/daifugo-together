import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const remoteScriptPath = resolve(
  projectRoot,
  'scripts/production-backup-remote.mjs',
);
const destination = resolve(
  projectRoot,
  process.argv[2] ??
    `data/backups/daifugo-production-${new Date().toISOString().replaceAll(':', '-')}.sqlite`,
);
const temporaryDestination = `${destination}.tmp`;

if (existsSync(destination) || existsSync(temporaryDestination)) {
  throw new Error(`Backup destination already exists: ${destination}`);
}

const remoteScript = await readFile(remoteScriptPath, 'utf8');
const fly = spawn(
  '/opt/homebrew/bin/fly',
  [
    'ssh',
    'console',
    '--app',
    'daifugo-together',
    '-C',
    'node --input-type=module',
  ],
  { stdio: ['pipe', 'pipe', 'pipe'] },
);

let stdout = '';
let stderr = '';
fly.stdout.setEncoding('utf8');
fly.stderr.setEncoding('utf8');
fly.stdout.on('data', (chunk) => {
  stdout += chunk;
});
fly.stderr.on('data', (chunk) => {
  stderr += chunk;
});
fly.stdin.end(remoteScript);

const exitCode = await new Promise((resolveExit, rejectExit) => {
  fly.on('error', rejectExit);
  fly.on('close', resolveExit);
});
if (exitCode !== 0) {
  throw new Error(
    `fly ssh console failed with exit code ${String(exitCode)}:\n${stderr}`,
  );
}

const combinedOutput = `${stdout}\n${stderr}`;
const sizeMatch = /SNAPSHOT_BYTES=(\d+)/u.exec(combinedOutput);
if (!sizeMatch) throw new Error('Remote snapshot size was not reported');
const expectedBytes = Number(sizeMatch[1]);
const base64 = stdout
  .split(/\r?\n/u)
  .filter((line) => line.startsWith('BASE64:'))
  .map((line) => line.slice('BASE64:'.length))
  .join('');
if (base64.length === 0) throw new Error('Remote snapshot body was empty');
const snapshot = Buffer.from(base64, 'base64');
if (snapshot.length !== expectedBytes) {
  throw new Error(
    `Snapshot size mismatch: expected ${String(expectedBytes)}, received ${String(snapshot.length)}`,
  );
}

await mkdir(dirname(destination), { recursive: true });
await writeFile(temporaryDestination, snapshot, { flag: 'wx', mode: 0o600 });

try {
  const require = createRequire(
    resolve(projectRoot, 'packages/server/package.json'),
  );
  const Database = require('better-sqlite3');
  const database = new Database(temporaryDestination, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const integrity = database.pragma('integrity_check')[0]?.integrity_check;
    if (integrity !== 'ok') {
      throw new Error(`SQLite integrity_check failed: ${String(integrity)}`);
    }
    const counts = Object.fromEntries(
      ['users', 'proposals', 'set_results', 'replay_records', 'game_sets'].map(
        (table) => [
          table,
          database.prepare(`SELECT count(*) AS count FROM ${table}`).get()
            .count,
        ],
      ),
    );
    console.log(JSON.stringify({ integrity, bytes: snapshot.length, counts }));
  } finally {
    database.close();
  }
  await rename(temporaryDestination, destination);
  console.log(`Backup saved to ${destination}`);
} catch (error) {
  await rm(temporaryDestination, { force: true });
  throw error;
}
