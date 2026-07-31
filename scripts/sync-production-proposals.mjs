#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  installDatabaseFile,
  importProposalData,
  productionExporterSource,
} from './sync-production-proposals-lib.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_APP = 'daifugo-together';
const DEFAULT_SOURCE_DATABASE = '/data/daifugo.sqlite';
const DEFAULT_TARGET_DATABASE = 'data/production-proposals.sqlite';

function usage() {
  console.log(`Usage:
  pnpm sync:production-proposals [options]

Options:
  --app <name>       Fly app name (default: ${DEFAULT_APP})
  --database <path>  Local output DB (default: ${DEFAULT_TARGET_DATABASE})
  --fly <path>       flyctl executable (default: fly)
  --help             Show this help

The destination is a proposal-only local database. Existing destination data is
replaced atomically and saved once as <path>.backup.`);
}

function parseArguments(argv) {
  const options = {
    app: DEFAULT_APP,
    targetDatabase: DEFAULT_TARGET_DATABASE,
    fly: process.env.FLYCTL_BIN ?? 'fly',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--help') return { ...options, help: true };
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${argument} には値が必要です`);
    }
    if (argument === '--app') options.app = value;
    else if (argument === '--database') options.targetDatabase = value;
    else if (argument === '--fly') options.fly = value;
    else throw new Error(`不明なオプションです: ${argument}`);
    index += 1;
  }
  return options;
}

function fetchProductionPayload(options) {
  const source = productionExporterSource(DEFAULT_SOURCE_DATABASE);
  const encoded = Buffer.from(source).toString('base64');
  const remoteCommand =
    `node --input-type=module -e ` +
    `"await import('data:text/javascript;base64,${encoded}')"`;
  const result = spawnSync(
    options.fly,
    ['ssh', 'console', '--app', options.app, '--command', remoteCommand],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    },
  );
  if (result.error) {
    throw new Error(`flyctl を実行できません: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`本番DBの読み取りに失敗しました\n${result.stderr.trim()}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error('flyctl から受け取った本番データを解析できませんでした');
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  const targetPath = resolve(repositoryRoot, options.targetDatabase);
  if (
    targetPath === DEFAULT_SOURCE_DATABASE ||
    targetPath.startsWith('/data/')
  ) {
    throw new Error('安全のため /data 配下を同期先には指定できません');
  }
  mkdirSync(dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${randomUUID()}.tmp`;

  try {
    console.error(`[1/3] ${options.app} の本番DBを読み取っています`);
    const payload = fetchProductionPayload(options);

    console.error('[2/3] ローカル専用DBを作成し、ユーザーを匿名化しています');
    const { SqlitePersistence } =
      await import('../packages/server/dist/persistence.js');
    const initialized = new SqlitePersistence(tempPath);
    initialized.close();

    const require = createRequire(
      resolve(repositoryRoot, 'packages/server/package.json'),
    );
    const Database = require('better-sqlite3');
    const database = new Database(tempPath);
    let counts;
    try {
      counts = importProposalData(database, payload);
      database.pragma('journal_mode = DELETE');
    } finally {
      database.close();
    }

    console.error('[3/3] 検証済みDBを配置しています');
    const backupPath = installDatabaseFile(tempPath, targetPath);
    console.log(
      JSON.stringify(
        {
          database: targetPath,
          backup: backupPath,
          counts,
        },
        null,
        2,
      ),
    );
    console.log(
      `起動例: DATABASE_PATH=${JSON.stringify(targetPath)} pnpm start`,
    );
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
