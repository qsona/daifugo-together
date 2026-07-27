import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { ScaffoldResult } from './scaffold.js';

const EXPECTED_FILES = new Set([
  'meta.json',
  'SPEC.json',
  'rule.ts',
  'rule.test.ts',
]);
const FORBIDDEN = [
  'require(',
  'process.',
  'fetch(',
  'eval(',
  'child_process',
  'node:',
  'Math.random',
  'new Date',
  'Date.now',
  'import(',
];

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function inspectGeneratedRule(
  scaffold: ScaffoldResult,
): Promise<{ ok: true } | { ok: false; violations: string[] }> {
  const violations: string[] = [];
  const entries = await readdir(scaffold.directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !EXPECTED_FILES.has(entry.name)) {
      violations.push(`${entry.name}: unexpected generated path`);
    }
  }
  for (const expected of EXPECTED_FILES) {
    if (!entries.some((entry) => entry.isFile() && entry.name === expected)) {
      violations.push(`${expected}: required file is missing`);
    }
  }
  const meta = await readFile(scaffold.metaPath);
  const spec = await readFile(scaffold.specPath);
  if (sha256(meta) !== scaffold.metaSha256) {
    violations.push('meta.json: scaffold content was modified');
  }
  if (sha256(spec) !== scaffold.specSha256) {
    violations.push('SPEC.json: scaffold content was modified');
  }
  for (const [name, maxBytes] of [
    ['rule.ts', 64 * 1024],
    ['rule.test.ts', 128 * 1024],
  ] as const) {
    const path = join(scaffold.directory, name);
    try {
      const size = (await stat(path)).size;
      if (size > maxBytes) {
        violations.push(`${name}: exceeds ${String(maxBytes)} bytes`);
      }
      const content = await readFile(path, 'utf8');
      for (const match of content.matchAll(
        /\b(?:import|export)\s+[\s\S]*?\sfrom\s+['"]([^'"]+)['"]/gu,
      )) {
        if (match[1] !== '@daifugo/core') {
          violations.push(
            `${name}: imports forbidden module ${match[1] ?? 'unknown'}`,
          );
        }
      }
      for (const match of content.matchAll(/\bimport\s*['"]([^'"]+)['"]/gu)) {
        if (match[1] !== '@daifugo/core') {
          violations.push(
            `${name}: imports forbidden module ${match[1] ?? 'unknown'}`,
          );
        }
      }
      for (const token of FORBIDDEN) {
        if (content.includes(token)) {
          violations.push(`${name}: contains forbidden token ${token}`);
        }
      }
    } catch {
      // The missing-file violation above is sufficient.
    }
  }
  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}
