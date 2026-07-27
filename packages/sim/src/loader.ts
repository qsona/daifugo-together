import { readdir, readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

import type { RuleMeta, RuleModule } from '@daifugo/core';

const RULE_DIRECTORY = /^r\d{4,}-[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function ruleModule(value: unknown): value is RuleModule {
  return (
    typeof value === 'object' &&
    value !== null &&
    'meta' in value &&
    'hooks' in value &&
    typeof value.meta === 'object' &&
    value.meta !== null &&
    typeof value.hooks === 'object' &&
    value.hooks !== null
  );
}

export async function loadRuleModules(options: {
  rulesRoot: string;
  newRuleId: string;
}): Promise<RuleModule[]> {
  const excludes = JSON.parse(
    await readFile(join(options.rulesRoot, 'rules-exclude.json'), 'utf8'),
  ) as unknown;
  if (
    !Array.isArray(excludes) ||
    excludes.some((value) => typeof value !== 'string')
  ) {
    throw new Error('rules-exclude.json must be a string array');
  }
  const excluded = new Set(excludes);
  const directories = (
    await readdir(options.rulesRoot, { withFileTypes: true })
  )
    .filter(
      (entry) =>
        entry.isDirectory() &&
        RULE_DIRECTORY.test(entry.name) &&
        (!excluded.has(entry.name) || entry.name === options.newRuleId),
    )
    .map((entry) => entry.name)
    .sort();
  const modules: RuleModule[] = [];
  for (const directory of directories) {
    const meta = JSON.parse(
      await readFile(join(options.rulesRoot, directory, 'meta.json'), 'utf8'),
    ) as RuleMeta;
    const loaded = (await import(
      pathToFileURL(join(options.rulesRoot, 'dist', directory, 'rule.js')).href
    )) as { rule?: unknown };
    if (!ruleModule(loaded.rule)) {
      throw new Error(`${directory}/rule.ts must export const rule`);
    }
    if (!isDeepStrictEqual(loaded.rule.meta, meta)) {
      throw new Error(`${directory}/rule.ts meta differs from meta.json`);
    }
    modules.push(loaded.rule);
  }
  return modules;
}
