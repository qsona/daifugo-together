import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
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
// rule-versions.json: エンジン側の事情で rule.ts を変更した (bundleHash が変わる) 場合に
// 該当ルールの version を繰り上げるための宣言。未記載のルールは version 1。
const versionOverrides = JSON.parse(
  await readFile(join(packageRoot, 'rule-versions.json'), 'utf8').catch(
    () => '{}',
  ),
);
if (
  typeof versionOverrides !== 'object' ||
  versionOverrides === null ||
  Array.isArray(versionOverrides) ||
  Object.entries(versionOverrides).some(
    ([ruleId, version]) =>
      !ruleDirectory.test(ruleId) ||
      !Number.isSafeInteger(version) ||
      version < 2,
  )
) {
  throw new Error(
    'rule-versions.json must map rule directory names to integer versions >= 2',
  );
}
const registrations = directories.map(
  (directory, index) =>
    `  { module: rule${String(index)}, moduleUrl: new URL('../${directory}/rule.js', import.meta.url).href, slug: '${directory.replace(/^r\d{4,}-/u, '')}', version: ${String(versionOverrides[directory] ?? 1)} },`,
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
