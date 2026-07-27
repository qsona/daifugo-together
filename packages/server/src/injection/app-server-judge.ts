import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface, type Interface } from 'node:readline';

import { buildInjectionJudgePrompt } from './judge-prompt.js';
import type {
  LocalL3Result,
  PendingLocalScreening,
} from './local-screening.js';

type JsonObject = Record<string, unknown>;

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export interface CompletedTurn {
  status: 'completed' | 'interrupted' | 'failed' | 'inProgress';
  items: unknown[];
  error?: { message?: string } | null;
}

export interface AppServerRpc {
  request(method: string, params: JsonObject): Promise<unknown>;
  notify(method: string, params: JsonObject): void;
  waitForTurn(threadId: string): Promise<CompletedTurn>;
  close(): void;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const CHATGPT_CODEX_BIN = '/Applications/ChatGPT.app/Contents/Resources/codex';
export const DEFAULT_SCREENING_MODEL = 'gpt-5.6-sol';

const L3_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'reason', 'evidence'],
  properties: {
    verdict: {
      type: 'string',
      enum: ['clean', 'suspicious', 'injection'],
    },
    reason: { type: 'string', minLength: 1, maxLength: 1_000 },
    evidence: {
      anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }],
    },
  },
} as const;

/**
 * C-2 の「モデルにツールを与えない」を app-server のスレッド設定で固定する。
 * 提案本文は turn input にだけ入り、config や shell 引数には入らない。
 */
export const TOOLLESS_THREAD_CONFIG = {
  web_search: 'disabled',
  features: {
    apps: false,
    goals: false,
    hooks: false,
    multi_agent: false,
    remote_plugin: false,
    shell_tool: false,
    unified_exec: false,
  },
  tools: { view_image: false },
  mcp_servers: {},
} as const;

function object(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function rpcError(value: unknown): Error {
  const error = object(value);
  const message =
    typeof error?.message === 'string'
      ? error.message
      : 'Codex app-server request failed';
  return new Error(message);
}

function completedTurn(value: unknown): {
  threadId: string;
  turn: CompletedTurn;
} | null {
  const params = object(value);
  const turn = object(params?.turn);
  if (
    typeof params?.threadId !== 'string' ||
    (turn?.status !== 'completed' &&
      turn?.status !== 'interrupted' &&
      turn?.status !== 'failed' &&
      turn?.status !== 'inProgress') ||
    !Array.isArray(turn.items)
  ) {
    return null;
  }
  return {
    threadId: params.threadId,
    turn: {
      status: turn.status,
      items: turn.items,
      ...(object(turn.error) ? { error: object(turn.error) } : {}),
    },
  };
}

export class StdioAppServerRpc implements AppServerRpc {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #lines: Interface;
  readonly #pending = new Map<number, PendingRequest>();
  readonly #turnWaiters = new Map<
    string,
    {
      resolve: (turn: CompletedTurn) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();
  readonly #completedTurns = new Map<string, CompletedTurn>();
  readonly #timeoutMs: number;
  #nextId = 1;
  #closed = false;

  private constructor(
    child: ChildProcessWithoutNullStreams,
    timeoutMs: number,
  ) {
    this.#child = child;
    this.#timeoutMs = timeoutMs;
    this.#lines = createInterface({ input: child.stdout });
    this.#lines.on('line', (line) => this.#receive(line));
    child.stderr.pipe(process.stderr);
    child.once('exit', (code, signal) => {
      this.#failAll(
        new Error(
          `Codex app-server exited (${code === null ? signal : String(code)})`,
        ),
      );
    });
    child.once('error', (error) => this.#failAll(error));
  }

  static async start(
    options: {
      codexBin?: string;
      timeoutMs?: number;
    } = {},
  ): Promise<StdioAppServerRpc> {
    const codexBin =
      options.codexBin ??
      process.env.CODEX_BIN ??
      (existsSync(CHATGPT_CODEX_BIN) ? CHATGPT_CODEX_BIN : 'codex');
    const child = spawn(codexBin, ['app-server', '--listen', 'stdio://'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const rpc = new StdioAppServerRpc(
      child,
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    try {
      await rpc.request('initialize', {
        clientInfo: {
          name: 'daifugo_e6_local_screening',
          title: 'Daifugo E6 Local Screening',
          version: '0.1.0',
        },
      });
      rpc.notify('initialized', {});
      return rpc;
    } catch (error) {
      rpc.close();
      throw error;
    }
  }

  request(method: string, params: JsonObject): Promise<unknown> {
    if (this.#closed) {
      return Promise.reject(new Error('Codex app-server is closed'));
    }
    const id = this.#nextId;
    this.#nextId += 1;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Codex app-server ${method} timed out`));
      }, this.#timeoutMs);
      this.#pending.set(id, { resolve, reject, timeout });
      this.#send({ method, id, params });
    });
  }

  notify(method: string, params: JsonObject): void {
    if (this.#closed) throw new Error('Codex app-server is closed');
    this.#send({ method, params });
  }

  waitForTurn(threadId: string): Promise<CompletedTurn> {
    const completed = this.#completedTurns.get(threadId);
    if (completed) {
      this.#completedTurns.delete(threadId);
      return Promise.resolve(completed);
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#turnWaiters.delete(threadId);
        reject(new Error(`Codex app-server turn ${threadId} timed out`));
      }, this.#timeoutMs);
      this.#turnWaiters.set(threadId, { resolve, reject, timeout });
    });
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#lines.close();
    this.#child.kill('SIGTERM');
    this.#failAll(new Error('Codex app-server was closed'));
  }

  #send(message: JsonObject): void {
    this.#child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #receive(line: string): void {
    let message: JsonObject | null;
    try {
      message = object(JSON.parse(line));
    } catch {
      return;
    }
    if (!message) return;
    if (typeof message.id === 'number' && typeof message.method !== 'string') {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error !== undefined) pending.reject(rpcError(message.error));
      else pending.resolve(message.result);
      return;
    }
    if (message.method === 'turn/completed') {
      const completion = completedTurn(message.params);
      if (!completion) return;
      const waiter = this.#turnWaiters.get(completion.threadId);
      if (waiter) {
        this.#turnWaiters.delete(completion.threadId);
        clearTimeout(waiter.timeout);
        waiter.resolve(completion.turn);
      } else {
        this.#completedTurns.set(completion.threadId, completion.turn);
      }
      return;
    }
    if (
      message.id !== undefined &&
      typeof message.method === 'string' &&
      (typeof message.id === 'number' || typeof message.id === 'string')
    ) {
      this.#send({
        id: message.id,
        error: {
          code: -32601,
          message: 'Local screening client does not support server requests',
        },
      });
    }
  }

  #failAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
    for (const waiter of this.#turnWaiters.values()) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    this.#turnWaiters.clear();
  }
}

function threadIdFrom(value: unknown): string {
  const result = object(value);
  const thread = object(result?.thread);
  if (typeof thread?.id !== 'string') {
    throw new Error('Codex app-server returned no thread id');
  }
  return thread.id;
}

function finalAgentText(turn: CompletedTurn): string {
  if (turn.status !== 'completed') {
    throw new Error(
      turn.error?.message ?? `Codex screening turn ended as ${turn.status}`,
    );
  }
  const unexpectedItem = turn.items.find((item) => {
    const value = object(item);
    return (
      typeof value?.type === 'string' &&
      value.type !== 'userMessage' &&
      value.type !== 'reasoning' &&
      value.type !== 'agentMessage'
    );
  });
  if (unexpectedItem) {
    throw new Error(
      `Codex screening turn attempted a disallowed item: ${String(object(unexpectedItem)?.type)}`,
    );
  }
  const messages = turn.items.flatMap((item) => {
    const value = object(item);
    return value?.type === 'agentMessage' && typeof value.text === 'string'
      ? [value.text]
      : [];
  });
  const text = messages.at(-1);
  if (!text) throw new Error('Codex screening turn returned no final message');
  return text;
}

function parseJudgment(
  text: string,
): Omit<LocalL3Result, 'model' | 'latencyMs'> {
  let value: JsonObject | null;
  try {
    value = object(JSON.parse(text));
  } catch {
    value = null;
  }
  if (
    !value ||
    (value.verdict !== 'clean' &&
      value.verdict !== 'suspicious' &&
      value.verdict !== 'injection') ||
    typeof value.reason !== 'string' ||
    value.reason.trim().length === 0 ||
    (value.evidence !== null && typeof value.evidence !== 'string')
  ) {
    throw new Error('Codex screening turn returned invalid structured output');
  }
  return {
    verdict: value.verdict,
    reason: value.reason.trim(),
    evidence:
      typeof value.evidence === 'string' && value.evidence.length > 0
        ? value.evidence
        : null,
  };
}

function signalLabels(signals: PendingLocalScreening['signals']): string[] {
  const labels: string[] = [];
  if (signals.layer0.invisibleChars) labels.push('L0:invisible_chars');
  if (signals.layer0.lengthExceeded) labels.push('L0:length_exceeded');
  labels.push(...signals.layer1.hard.map((hit) => `L1-hard:${hit}`));
  labels.push(...signals.layer1.soft.map((hit) => `L1-soft:${hit}`));
  for (const [name, active] of Object.entries(signals.layer2)) {
    if (active) labels.push(`L2:${name}`);
  }
  return labels;
}

export class CodexAppServerJudge {
  readonly #rpc: AppServerRpc;
  readonly #model: string;
  readonly #effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  readonly #cwd: string;
  readonly #now: () => number;

  constructor(options: {
    rpc: AppServerRpc;
    model: string;
    effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    cwd?: string;
    now?: () => number;
  }) {
    this.#rpc = options.rpc;
    this.#model = options.model;
    this.#effort = options.effort ?? 'medium';
    this.#cwd = options.cwd ?? process.cwd();
    this.#now = options.now ?? Date.now;
  }

  async judge(item: PendingLocalScreening): Promise<LocalL3Result> {
    const startedAt = this.#now();
    const thread = await this.#rpc.request('thread/start', {
      approvalPolicy: 'never',
      baseInstructions:
        'You are a text classifier. Do not use tools. Return only JSON matching the requested schema.',
      config: TOOLLESS_THREAD_CONFIG,
      cwd: this.#cwd,
      ephemeral: true,
      model: this.#model,
      sandbox: 'read-only',
    });
    const threadId = threadIdFrom(thread);
    const completion = this.#rpc.waitForTurn(threadId);
    await this.#rpc.request('turn/start', {
      approvalPolicy: 'never',
      effort: this.#effort,
      input: [
        {
          type: 'text',
          text: buildInjectionJudgePrompt({
            name: item.proposal.name,
            body: item.proposal.body,
            signals: signalLabels(item.signals),
          }),
        },
      ],
      outputSchema: L3_OUTPUT_SCHEMA,
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
      threadId,
    });
    const result = parseJudgment(finalAgentText(await completion));
    return {
      ...result,
      model: this.#model,
      latencyMs: Math.max(0, this.#now() - startedAt),
    };
  }
}
