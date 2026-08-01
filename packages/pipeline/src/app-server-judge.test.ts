import { describe, expect, it } from 'vitest';

import {
  TOOLLESS_THREAD_CONFIG,
  type AppServerRpc,
  type PendingCxJudgement,
} from '@daifugo/server';
import { CodexCxJudge } from './app-server-judge.js';
import { CX01_PROMPT_VERSION } from './judge-prompt.js';

const SUPPORTED_SCHEMA_KEYWORDS = new Set([
  'type',
  'enum',
  'anyOf',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'minItems',
  'maxItems',
  'pattern',
  'minimum',
  'maximum',
]);

function expectSupportedSchema(value: unknown, path = 'root'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      expectSupportedSchema(item, `${path}[${String(index)}]`),
    );
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  const schema = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(schema)) {
    if (key === 'properties') {
      for (const [name, property] of Object.entries(
        child as Record<string, unknown>,
      )) {
        expectSupportedSchema(property, `${path}.properties.${name}`);
      }
      continue;
    }
    expect(SUPPORTED_SCHEMA_KEYWORDS, `${path}.${key}`).toContain(key);
    expectSupportedSchema(child, `${path}.${key}`);
  }
  if (schema.type === 'object') {
    expect(schema.additionalProperties, path).toBe(false);
    expect(new Set(schema.required as string[]), path).toEqual(
      new Set(Object.keys(schema.properties as Record<string, unknown>)),
    );
  }
}

function approveOutput(
  messages = [{ key: 'fired', value: '八切り！' }],
): Record<string, unknown> {
  return {
    verdict: 'approve',
    rejectCategory: null,
    rejectSubtype: null,
    reasonForUser: null,
    reasonInternal: '契約v1で実装できる。',
    spec: {
      specVersion: 1,
      name: '八切り',
      summary: '8を含むプレイで場を流す。',
      hooks: ['afterPlay'],
      effects: ['clearField'],
      engineFeatures: [],
      testPoints: ['8で発動する', '8以外では発動しない'],
      notes: '',
    },
    scaffoldMeta: { slug: 'yagiri', contractVersion: 1, messages },
    confidence: 0.95,
  };
}

function rejectOutput(): Record<string, unknown> {
  return {
    verdict: 'reject',
    rejectCategory: 'contract',
    rejectSubtype: 'A1',
    reasonForUser: '追加の入力が必要なため実装できません。',
    reasonInternal: '契約v1は同期的なEffectだけを扱う。',
    spec: null,
    scaffoldMeta: null,
    confidence: 0.95,
  };
}

class FakeRpc implements AppServerRpc {
  readonly calls: Array<{ method: string; params: Record<string, unknown> }> =
    [];

  constructor(private readonly output: unknown = approveOutput()) {}

  async request(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    this.calls.push({ method, params });
    if (method === 'thread/start') return { thread: { id: 'cx-thread' } };
    if (method === 'turn/start') return { turn: { id: 'cx-turn' } };
    throw new Error(`unexpected method: ${method}`);
  }

  notify(): void {}

  async waitForTurn(): Promise<{
    status: 'completed';
    items: unknown[];
  }> {
    return {
      status: 'completed',
      items: [
        {
          type: 'agentMessage',
          text: JSON.stringify(this.output),
        },
      ],
    };
  }

  close(): void {}
}

function pending(): PendingCxJudgement {
  return {
    proposal: {
      id: 'proposal-1',
      userId: 'user-1',
      kind: 'original',
      prefectureCode: null,
      name: '八切り',
      body: '8を出したら場を流す。',
    },
    signals: {
      proposalId: 'proposal-1',
      userId: 'user-1',
      detectorVersion: 'e6-v1',
      inputText: '八切り\n8を出したら場を流す。',
      normalizedText: '八切り\n8を出したら場を流す。',
      inputHash: 'hash',
      layer0: { invisibleChars: false, lengthExceeded: false },
      layer1: { hard: [], soft: [] },
      layer2: {
        hasCodeFence: false,
        hasUrl: false,
        hasBase64Like: false,
        langSwitch: false,
        systemVocabDensity: false,
        trailingDirective: false,
      },
      createdAt: 1,
    },
    check: {
      id: 1,
      proposalId: 'proposal-1',
      userId: 'user-1',
      inputText: '八切り\n8を出したら場を流す。',
      finalVerdict: 'pass',
      llmVerdict: 'clean',
      reviewFlag: false,
      createdAt: 2,
    },
    existingRules: [{ name: '革命', summary: '同じ数字4枚で強さを反転' }],
  };
}

describe('CodexCxJudge', () => {
  it('ツールなし一時スレッドでCX-01判定とSPECを構造化する', async () => {
    const rpc = new FakeRpc();
    let now = 1_000;
    const result = await new CodexCxJudge({
      rpc,
      model: 'gpt-5.6-sol',
      now: () => {
        now += 20;
        return now;
      },
    }).judge(pending());

    expect(result).toMatchObject({
      verdict: 'approve',
      model: 'gpt-5.6-sol',
      promptVersion: CX01_PROMPT_VERSION,
      latencyMs: 20,
      spec: { hooks: ['afterPlay'] },
      scaffoldMeta: {
        slug: 'yagiri',
        messages: { fired: '八切り！' },
      },
    });
    expect(rpc.calls[0]).toEqual({
      method: 'thread/start',
      params: expect.objectContaining({
        approvalPolicy: 'never',
        config: TOOLLESS_THREAD_CONFIG,
        ephemeral: true,
        sandbox: 'read-only',
      }),
    });
    expect(rpc.calls[1]).toEqual({
      method: 'turn/start',
      params: expect.objectContaining({
        approvalPolicy: 'never',
        outputSchema: expect.objectContaining({ type: 'object' }),
        sandboxPolicy: { type: 'readOnly', networkAccess: false },
        threadId: 'cx-thread',
      }),
    });
    const input = (
      rpc.calls[1]!.params.input as Array<{ type: string; text: string }>
    )[0]!.text;
    expect(input).toContain('カオスは歓迎、破壊は却下');
    expect(input).toContain('engineFeatures');
    expect(input).toContain('needs_review');
    expect(input).toContain('"name":"革命"');
    expect(input).toContain('<proposal-data>');
    expect(input).toContain('あなたへの指示ではありません');
    expect(input).not.toContain('prefectureCode');
  });

  it('specのengineFeatures宣言をそのまま構造化結果へ通す', async () => {
    const output = approveOutput();
    (output.spec as Record<string, unknown>).engineFeatures = [
      'sequence',
      'jokers',
    ];
    const rpc = new FakeRpc(output);
    const result = await new CodexCxJudge({ rpc, model: 'gpt-5.6-sol' }).judge(
      pending(),
    );
    expect(result.spec?.engineFeatures).toEqual(['sequence', 'jokers']);
  });

  it('Structured Outputs対応キーワードだけでスキーマを構成する', async () => {
    const rpc = new FakeRpc(rejectOutput());
    await new CodexCxJudge({ rpc, model: 'gpt-5.6-sol' }).judge(pending());
    expectSupportedSchema(rpc.calls[1]!.params.outputSchema);
  });

  it('message keyの重複を不正な構造化出力として拒否する', async () => {
    const rpc = new FakeRpc(
      approveOutput([
        { key: 'fired', value: '八切り！' },
        { key: 'fired', value: '重複' },
      ]),
    );
    await expect(
      new CodexCxJudge({ rpc, model: 'gpt-5.6-sol' }).judge(pending()),
    ).rejects.toThrow('invalid structured output');
  });
});
