import {
  finalAgentText,
  threadIdFrom,
  TOOLLESS_THREAD_CONFIG,
  type AppServerRpc,
  parseAiJudgement,
  type AiJudgementResult,
  type PendingCxJudgement,
} from '@daifugo/server';
import { buildCxJudgePrompt, CX01_PROMPT_VERSION } from './judge-prompt.js';

export const CX01_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'verdict',
    'rejectCategory',
    'rejectSubtype',
    'reasonForUser',
    'reasonInternal',
    'spec',
    'scaffoldMeta',
    'extensionNeeded',
    'confidence',
  ],
  properties: {
    verdict: {
      type: 'string',
      enum: ['approve', 'reject', 'needs_review'],
    },
    rejectCategory: {
      anyOf: [
        {
          type: 'string',
          enum: [
            'contract',
            'game_breaking',
            'inappropriate',
            'duplicate',
            'unintelligible',
            'other',
          ],
        },
        { type: 'null' },
      ],
    },
    rejectSubtype: {
      anyOf: [
        {
          type: 'string',
          enum: [
            'A1',
            'A2',
            'A3',
            'A4',
            'B1',
            'B2',
            'B3',
            'B4',
            'B5',
            'C1',
            'C2',
            'C3',
          ],
        },
        { type: 'null' },
      ],
    },
    reasonForUser: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    },
    reasonInternal: { type: 'string' },
    spec: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: [
            'specVersion',
            'name',
            'summary',
            'hooks',
            'effects',
            'engineFeatures',
            'testPoints',
            'notes',
          ],
          properties: {
            specVersion: { type: 'integer', enum: [1] },
            name: { type: 'string' },
            summary: { type: 'string' },
            hooks: {
              type: 'array',
              maxItems: 6,
              items: {
                type: 'string',
                enum: [
                  'modifyLegality',
                  'modifyStrength',
                  'afterPlay',
                  'afterFieldClear',
                  'onGameStart',
                  'onGameEnd',
                ],
              },
            },
            // `announce` covers both public notices and player-targeted private notices.
            effects: {
              type: 'array',
              maxItems: 8,
              items: {
                type: 'string',
                enum: [
                  'clearField',
                  'clearSuitBinding',
                  'requestChoice',
                  'skipTurns',
                  'reverseTurnOrder',
                  'forceRank',
                  'moveCards',
                  'setMemory',
                  'announce',
                ],
              },
            },
            engineFeatures: {
              type: 'array',
              maxItems: 2,
              items: {
                type: 'string',
                enum: ['sequence', 'jokers'],
              },
            },
            testPoints: {
              type: 'array',
              minItems: 1,
              maxItems: 20,
              items: { type: 'string' },
            },
            notes: { type: 'string' },
          },
        },
        { type: 'null' },
      ],
    },
    scaffoldMeta: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['slug', 'contractVersion', 'messages'],
          properties: {
            slug: {
              type: 'string',
              pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
            },
            contractVersion: {
              type: 'integer',
              enum: [1, 2],
            },
            messages: {
              type: 'array',
              maxItems: 20,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['key', 'value'],
                properties: {
                  key: {
                    type: 'string',
                    pattern: '^[a-z][a-z0-9_]{0,63}$',
                  },
                  value: { type: 'string' },
                },
              },
            },
          },
        },
        { type: 'null' },
      ],
    },
    // Structured Outputs は minLength/maxLength を受け付けないため、capabilities の
    // 64文字上限と sketch の 1〜1000 文字はプロンプト文言と parseAiJudgement 側で担保する。
    extensionNeeded: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['capabilities', 'sketch'],
          properties: {
            capabilities: {
              type: 'array',
              minItems: 1,
              maxItems: 4,
              items: {
                type: 'string',
                pattern: '^[a-z][a-z0-9_-]*(:[a-z0-9_.-]+)?$',
              },
            },
            sketch: { type: 'string' },
          },
        },
        { type: 'null' },
      ],
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
} as const;

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function messageRecord(value: unknown): Record<string, string> | null {
  if (!Array.isArray(value)) return null;

  const result: Record<string, string> = {};
  for (const valueEntry of value) {
    const entry = object(valueEntry);
    if (
      !entry ||
      typeof entry.key !== 'string' ||
      typeof entry.value !== 'string' ||
      Object.hasOwn(result, entry.key)
    ) {
      return null;
    }
    result[entry.key] = entry.value;
  }
  return result;
}

function normalizeTransportOutput(value: unknown): JsonObject | null {
  const input = object(value);
  if (!input) return null;
  if (input.scaffoldMeta === null) return input;

  const scaffoldMeta = object(input.scaffoldMeta);
  if (!scaffoldMeta) return null;
  const messages = messageRecord(scaffoldMeta.messages);
  if (!messages) return null;

  return {
    ...input,
    scaffoldMeta: {
      ...scaffoldMeta,
      messages,
    },
  };
}

function parseOutput(
  text: string,
  metadata: { model: string; latencyMs: number },
): AiJudgementResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('CX-01 turn returned non-JSON output');
  }
  const normalized = normalizeTransportOutput(value);
  const parsed = normalized
    ? parseAiJudgement({
        ...normalized,
        ...metadata,
        promptVersion: CX01_PROMPT_VERSION,
      })
    : null;
  if (!parsed) throw new Error('CX-01 turn returned invalid structured output');
  return parsed;
}

export class CodexCxJudge {
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

  async judge(item: PendingCxJudgement): Promise<AiJudgementResult> {
    const startedAt = this.#now();
    const thread = await this.#rpc.request('thread/start', {
      approvalPolicy: 'never',
      baseInstructions:
        'You are a rule adjudicator. Never use tools. Return only JSON matching the requested schema.',
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
      input: [{ type: 'text', text: buildCxJudgePrompt(item) }],
      outputSchema: CX01_OUTPUT_SCHEMA,
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
      threadId,
    });
    return parseOutput(finalAgentText(await completion), {
      model: this.#model,
      latencyMs: Math.max(0, this.#now() - startedAt),
    });
  }
}
