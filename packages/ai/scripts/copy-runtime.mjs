import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(join(packageRoot, 'dist'), { recursive: true });
await copyFile(
  join(packageRoot, 'src', 'worker-entry.js'),
  join(packageRoot, 'dist', 'worker-entry.js'),
);
