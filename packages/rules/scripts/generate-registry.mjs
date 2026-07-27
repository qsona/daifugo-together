import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootArgument = process.argv.indexOf('--root');
const packageRoot =
  rootArgument === -1
    ? join(dirname(fileURLToPath(import.meta.url)), '..')
    : resolve(process.argv[rootArgument + 1] ?? '');
if (rootArgument !== -1 && !process.argv[rootArgument + 1]) {
  throw new Error('--root requires a package directory');
}
const generatedDir = join(packageRoot, 'generated');
const ruleDirectory = /^r\d{4,}-[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const directories = (await readdir(packageRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && ruleDirectory.test(entry.name))
  .map((entry) => entry.name)
  .sort();
const imports = directories.map(
  (directory, index) =>
    `import { rule as rule${String(index)} } from '../${directory}/rule.js';`,
);
const registrations = directories.map(
  (directory, index) =>
    `  { module: rule${String(index)}, moduleUrl: new URL('../${directory}/rule.js', import.meta.url).href, slug: '${directory.replace(/^r\d{4,}-/u, '')}', version: 1 },`,
);
const source = `${imports.join('\n')}

import type { RuleModule } from '@daifugo/core';

export const generatedRuleLocations: {
  module: RuleModule;
  moduleUrl: string;
  slug: string;
  version: number;
}[] = [
${registrations.join('\n')}
];
`;

await mkdir(generatedDir, { recursive: true });
await writeFile(join(generatedDir, 'registry.ts'), source);
