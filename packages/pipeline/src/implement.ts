import type { QueuedImplementation } from '@daifugo/server';

import { createRuleScaffold, type ScaffoldResult } from './scaffold.js';
import { inspectGeneratedRule } from './inspector.js';

export interface CodexRunner {
  run(input: {
    directory: string;
    promptPath: string;
  }): Promise<{ status: 'completed' } | { status: 'failed'; error: string }>;
}

export type ImplementationResult =
  | { status: 'ready'; scaffold: ScaffoldResult }
  | { status: 'codex_failed'; error: string; scaffold: ScaffoldResult }
  | {
      status: 'inspect_failed';
      violations: string[];
      scaffold: ScaffoldResult;
    };

export async function implementQueuedRule(options: {
  item: QueuedImplementation;
  rulesRoot: string;
  promptPath: string;
  runner: CodexRunner;
}): Promise<ImplementationResult> {
  const scaffold = await createRuleScaffold(options.item, options.rulesRoot);
  return implementScaffold({
    scaffold,
    promptPath: options.promptPath,
    runner: options.runner,
  });
}

export async function implementScaffold(options: {
  scaffold: ScaffoldResult;
  promptPath: string;
  runner: CodexRunner;
}): Promise<ImplementationResult> {
  const { scaffold } = options;
  const generated = await options.runner.run({
    directory: scaffold.directory,
    promptPath: options.promptPath,
  });
  if (generated.status === 'failed') {
    return { status: 'codex_failed', error: generated.error, scaffold };
  }
  const inspection = await inspectGeneratedRule(scaffold);
  return inspection.ok
    ? { status: 'ready', scaffold }
    : {
        status: 'inspect_failed',
        violations: inspection.violations,
        scaffold,
      };
}
