import { copyFileSync, existsSync, renameSync, rmSync } from 'node:fs';

export const SYNC_FORMAT_VERSION = 1;
export const LOCAL_GOD_USER = Object.freeze({
  user_id: 'local-production-proposals-god',
  user_token: 'local-production-proposals-god-token',
  display_name: '本番提案データの神',
  google_sub: 'local-production-proposals-god',
  registered_at: 0,
  proposals_seen_at: 0,
  proposal_suspended_until: null,
  created_at: 0,
});

export const SYNC_TABLES = Object.freeze([
  'proposals',
  'proposal_signal_checks',
  'proposal_checks',
  'judgements',
  'pipeline_jobs',
]);

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function validatePayload(payload) {
  if (
    payload === null ||
    typeof payload !== 'object' ||
    payload.formatVersion !== SYNC_FORMAT_VERSION ||
    payload.tables === null ||
    typeof payload.tables !== 'object'
  ) {
    throw new Error('本番データの形式が不正です');
  }
  if ('users' in payload.tables) {
    throw new Error('安全のため users テーブルを含むデータは取り込めません');
  }
  for (const table of SYNC_TABLES) {
    if (!Array.isArray(payload.tables[table])) {
      throw new Error(`本番データに ${table} テーブルがありません`);
    }
  }
  return payload;
}

function localColumns(database, table) {
  return new Set(
    database
      .prepare(`PRAGMA table_info(${quoteIdentifier(table)})`)
      .all()
      .map((column) => column.name),
  );
}

function anonymizedRow(table, row) {
  if (table === 'proposals') {
    return { ...row, author_id: LOCAL_GOD_USER.user_id };
  }
  if (table === 'proposal_signal_checks' || table === 'proposal_checks') {
    return { ...row, user_id: LOCAL_GOD_USER.user_id };
  }
  if (table === 'judgements' && row.actor !== null) {
    return { ...row, actor: LOCAL_GOD_USER.user_id };
  }
  return row;
}

function insertRows(database, table, rows) {
  if (rows.length === 0) return;
  const columns = localColumns(database, table);
  const usableColumns = Object.keys(rows[0]).filter((column) =>
    columns.has(column),
  );
  if (usableColumns.length === 0) {
    throw new Error(`${table} に取り込める列がありません`);
  }
  const sql = `INSERT INTO ${quoteIdentifier(table)} (${usableColumns
    .map(quoteIdentifier)
    .join(', ')}) VALUES (${usableColumns.map(() => '?').join(', ')})`;
  const insert = database.prepare(sql);
  for (const original of rows) {
    const row = anonymizedRow(table, original);
    insert.run(...usableColumns.map((column) => row[column] ?? null));
  }
}

function insertGodUser(database) {
  const columns = localColumns(database, 'users');
  const usableColumns = Object.keys(LOCAL_GOD_USER).filter((column) =>
    columns.has(column),
  );
  const sql = `INSERT INTO users (${usableColumns
    .map(quoteIdentifier)
    .join(', ')}) VALUES (${usableColumns.map(() => '?').join(', ')})`;
  database
    .prepare(sql)
    .run(...usableColumns.map((column) => LOCAL_GOD_USER[column]));
}

export function importProposalData(database, untrustedPayload) {
  const payload = validatePayload(untrustedPayload);
  database.pragma('foreign_keys = OFF');
  const importAll = database.transaction(() => {
    insertGodUser(database);
    for (const table of SYNC_TABLES) {
      insertRows(database, table, payload.tables[table]);
    }
  });
  importAll();
  database.pragma('foreign_keys = ON');

  const foreignKeyProblems = database.pragma('foreign_key_check');
  if (foreignKeyProblems.length > 0) {
    throw new Error(
      `同期後の外部キー検査に失敗しました: ${JSON.stringify(foreignKeyProblems)}`,
    );
  }
  const copiedUsers = database
    .prepare('SELECT COUNT(*) AS count FROM users WHERE user_id <> ?')
    .get(LOCAL_GOD_USER.user_id).count;
  if (copiedUsers !== 0) {
    throw new Error('同期先にローカル神ユーザー以外のユーザーが存在します');
  }

  return Object.fromEntries(
    SYNC_TABLES.map((table) => [
      table,
      database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
    ]),
  );
}

export function installDatabaseFile(tempPath, targetPath) {
  const backupPath = `${targetPath}.backup`;
  const createdBackup = existsSync(targetPath);
  if (createdBackup) {
    copyFileSync(targetPath, backupPath);
  }
  try {
    renameSync(tempPath, targetPath);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
  return createdBackup ? backupPath : null;
}

export function productionExporterSource(sourceDatabasePath) {
  return `
import { createRequire } from "node:module";
const require = createRequire("/app/packages/server/package.json");
const Database = require("better-sqlite3");
const database = new Database(${JSON.stringify(sourceDatabasePath)}, {
  readonly: true,
  fileMustExist: true,
});
database.pragma("query_only = ON");
const tableNames = ${JSON.stringify(SYNC_TABLES)};
const tables = database.transaction(() =>
  Object.fromEntries(
    tableNames.map((table) => [
      table,
      database.prepare(\`SELECT * FROM "\${table}" ORDER BY rowid\`).all(),
    ]),
  ),
)();
database.close();
process.stdout.write(JSON.stringify({
  formatVersion: ${SYNC_FORMAT_VERSION},
  tables,
}));
`;
}
