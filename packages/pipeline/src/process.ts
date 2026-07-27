import { spawn } from 'node:child_process';

export interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface ProcessPort {
  run(input: {
    command: string;
    args: string[];
    cwd: string;
    stdin?: string;
    timeoutMs: number;
  }): Promise<ProcessResult>;
}

function appendCapped(
  current: string,
  chunk: Buffer,
  maxBytes: number,
): string {
  if (Buffer.byteLength(current) >= maxBytes) return current;
  return `${current}${chunk.toString('utf8')}`.slice(0, maxBytes);
}

export class SpawnProcessPort implements ProcessPort {
  async run(input: {
    command: string;
    args: string[];
    cwd: string;
    stdin?: string;
    timeoutMs: number;
  }): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(input.command, input.args, {
        cwd: input.cwd,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let forceKill: NodeJS.Timeout | undefined;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        forceKill = setTimeout(() => child.kill('SIGKILL'), 5_000);
      }, input.timeoutMs);
      child.stdout.on('data', (chunk: Buffer) => {
        stdout = appendCapped(stdout, chunk, 64 * 1024);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = appendCapped(stderr, chunk, 64 * 1024);
      });
      child.once('error', (error) => {
        clearTimeout(timeout);
        if (forceKill) clearTimeout(forceKill);
        reject(error);
      });
      child.once('close', (exitCode) => {
        clearTimeout(timeout);
        if (forceKill) clearTimeout(forceKill);
        resolve({ exitCode, stdout, stderr, timedOut });
      });
      child.stdin.end(input.stdin);
    });
  }
}
