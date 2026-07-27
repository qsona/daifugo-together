import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type { RuleModule } from '@daifugo/core';

import { generatedRuleLocations } from '../generated/registry.js';

export interface RuleCodeBundle {
  module: RuleModule;
  moduleUrl: string;
  bundleHash: string;
  slug: string;
  version: number;
}

export async function loadRuleCodeBundles(): Promise<RuleCodeBundle[]> {
  return Promise.all(
    generatedRuleLocations.map(
      async ({ module, moduleUrl, slug, version }) => ({
        module,
        moduleUrl,
        bundleHash: createHash('sha256')
          .update(await readFile(new URL(moduleUrl)))
          .digest('hex'),
        slug,
        version,
      }),
    ),
  );
}
