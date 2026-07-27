import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { CodexRunner } from './implement.js';
import { SpawnProcessPort, type ProcessPort } from './process.js';

export const DEFAULT_CODEX_TIMEOUT_MS = 20 * 60 * 1_000;

async function generatedFilesExist(directory: string): Promise<boolean> {
  try {
    await Promise.all([
      access(join(directory, 'rule.ts')),
      access(join(directory, 'rule.test.ts')),
    ]);
    return true;
  } catch {
    return false;
  }
}

export class SubscriptionCodexRunner implements CodexRunner {
  readonly #process: ProcessPort;
  readonly #timeoutMs: number;
  readonly #executable: string;

  constructor(
    options: {
      process?: ProcessPort;
      timeoutMs?: number;
      executable?: string;
    } = {},
  ) {
    this.#process = options.process ?? new SpawnProcessPort();
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_CODEX_TIMEOUT_MS;
    this.#executable = options.executable ?? 'codex';
  }

  async run(input: { directory: string; promptPath: string }) {
    const prompt = await readFile(input.promptPath, 'utf8');
    let result;
    try {
      result = await this.#process.run({
        command: this.#executable,
        args: [
          'exec',
          '--cd',
          input.directory,
          '--sandbox',
          'workspace-write',
          '--ephemeral',
          '-',
        ],
        cwd: input.directory,
        stdin: prompt,
        timeoutMs: this.#timeoutMs,
      });
    } catch (error) {
      return {
        status: 'failed' as const,
        code: 'infra' as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    if (result.timedOut) {
      return {
        status: 'failed' as const,
        code: 'codex_timeout' as const,
        error: `codex exceeded ${String(this.#timeoutMs)}ms`,
      };
    }
    if (result.exitCode !== 0) {
      return {
        status: 'failed' as const,
        code: 'infra' as const,
        error:
          result.stderr.trim() ||
          `codex exited with ${String(result.exitCode)}`,
      };
    }
    if (!(await generatedFilesExist(input.directory))) {
      return {
        status: 'failed' as const,
        code: 'codex_empty' as const,
        error: 'codex completed without both generated rule files',
      };
    }
    return { status: 'completed' as const };
  }
}
