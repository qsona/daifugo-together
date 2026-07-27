import {
  finalAgentText,
  threadIdFrom,
  TOOLLESS_THREAD_CONFIG,
  type AppServerRpc,
} from '../injection/app-server-judge.js';
import { buildCxJudgePrompt, CX01_PROMPT_VERSION } from './judge-prompt.js';
import type { PendingCxJudgement } from './repository.js';
import { parseAiJudgement, type AiJudgementResult } from './service.js';

const CX01_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'verdict',
    'rejectCategory',
    'rejectSubtype',
    'reasonForUser',
    'reasonInternal',
    'spec',
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
      anyOf: [
        { type: 'string', minLength: 1, maxLength: 1_000 },
        { type: 'null' },
      ],
    },
    reasonInternal: { type: 'string', minLength: 1, maxLength: 4_000 },
    spec: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: [
            'specVersion',
            'slug',
            'name',
            'summary',
            'hooks',
            'effects',
            'messages',
            'testPoints',
            'notes',
          ],
          properties: {
            specVersion: { type: 'integer', const: 1 },
            slug: {
              type: 'string',
              pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
              maxLength: 48,
            },
            name: { type: 'string', minLength: 1, maxLength: 40 },
            summary: { type: 'string', minLength: 1, maxLength: 1_000 },
            hooks: {
              type: 'array',
              uniqueItems: true,
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
            effects: {
              type: 'array',
              uniqueItems: true,
              maxItems: 7,
              items: {
                type: 'string',
                enum: [
                  'clearField',
                  'skipTurns',
                  'reverseTurnOrder',
                  'forceRank',
                  'moveCards',
                  'setMemory',
                  'announce',
                ],
              },
            },
            messages: {
              type: 'object',
              maxProperties: 20,
              propertyNames: { pattern: '^[a-z][a-z0-9_]{0,63}$' },
              additionalProperties: {
                type: 'string',
                minLength: 1,
                maxLength: 200,
              },
            },
            testPoints: {
              type: 'array',
              minItems: 1,
              maxItems: 20,
              items: { type: 'string', minLength: 1, maxLength: 300 },
            },
            notes: { type: 'string', maxLength: 1_000 },
          },
        },
        { type: 'null' },
      ],
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
} as const;

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
  const parsed = parseAiJudgement({
    ...(value as object),
    ...metadata,
    promptVersion: CX01_PROMPT_VERSION,
  });
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
