import type { ProcessPort, ProcessResult } from './process.js';
import { SpawnProcessPort } from './process.js';
import type { ScaffoldResult } from './scaffold.js';
import type { ImplementationVerifier } from './implementation-driver.js';

const COMMAND_TIMEOUT_MS = 10 * 60 * 1_000;

function failure(label: string, result: ProcessResult): string {
  const detail =
    result.stderr.trim() ||
    result.stdout.trim() ||
    (result.timedOut
      ? 'command timed out'
      : `command exited with ${String(result.exitCode)}`);
  return `${label}: ${detail.slice(0, 4_000)}`;
}

export class LocalImplementationVerifier implements ImplementationVerifier {
  readonly #process: ProcessPort;

  constructor(process: ProcessPort = new SpawnProcessPort()) {
    this.#process = process;
  }

  async verify(input: {
    workspace: string;
    scaffold: ScaffoldResult;
  }): Promise<string[]> {
    const typecheck = await this.#process.run({
      command: 'pnpm',
      args: ['--filter', '@daifugo/rules', 'typecheck'],
      cwd: input.workspace,
      timeoutMs: COMMAND_TIMEOUT_MS,
    });
    if (typecheck.timedOut || typecheck.exitCode !== 0) {
      return [failure('typecheck', typecheck)];
    }
    const test = await this.#process.run({
      command: 'pnpm',
      args: ['exec', 'vitest', 'run', 'rule.test.ts'],
      cwd: input.scaffold.directory,
      timeoutMs: COMMAND_TIMEOUT_MS,
    });
    return test.timedOut || test.exitCode !== 0
      ? [failure('rule.test.ts', test)]
      : [];
  }
}
