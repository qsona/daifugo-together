import { readdir, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(packageRoot, '../..');
const target = resolve(packageRoot, process.argv[2] ?? '');
const cliArguments = process.argv
  .slice(3)
  .filter((argument) => argument !== '--');
const trackedExtensions = new Set([
  '.ts',
  '.mts',
  '.cts',
  '.json',
  '.mjs',
  '.yaml',
  '.yml',
]);
const ignoredDirectories = new Set([
  '.git',
  '.worktrees',
  'coverage',
  'dist',
  'node_modules',
]);
const buildInputs = [
  join(repositoryRoot, 'pnpm-lock.yaml'),
  join(repositoryRoot, 'tsconfig.base.json'),
  ...['core', 'ai', 'rules', 'server', 'pipeline'].flatMap((name) => [
    join(repositoryRoot, 'packages', name, 'package.json'),
    join(repositoryRoot, 'packages', name, 'tsconfig.json'),
    join(repositoryRoot, 'packages', name, 'tsconfig.build.json'),
    join(repositoryRoot, 'packages', name, 'src'),
    join(repositoryRoot, 'packages', name, 'scripts'),
  ]),
];

if (!process.argv[2] || !target.startsWith(`${packageRoot}/dist/`)) {
  throw new Error('usage: run-cli.mjs dist/ENTRY.js [ARGUMENTS...]');
}

async function isNewerThan(path, timestamp) {
  let metadata;
  try {
    metadata = await stat(path);
  } catch {
    return false;
  }
  if (metadata.isFile()) {
    return trackedExtensions.has(extname(path)) && metadata.mtimeMs > timestamp;
  }
  if (!metadata.isDirectory()) return false;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    if (await isNewerThan(join(path, entry.name), timestamp)) return true;
  }
  return false;
}

async function buildIsStale() {
  let targetMetadata;
  try {
    targetMetadata = await stat(target);
  } catch {
    return true;
  }
  for (const input of buildInputs) {
    if (await isNewerThan(input, targetMetadata.mtimeMs)) return true;
  }
  return false;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: packageRoot,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.signal) {
    process.kill(process.pid, result.signal);
    return;
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (await buildIsStale()) {
  process.stderr.write(
    '[pipeline] source changed since the last build; rebuilding once.\n',
  );
  run('pnpm', ['build']);
}

run(process.execPath, [
  '--env-file-if-exists=../../.env.local',
  target,
  ...cliArguments,
]);
