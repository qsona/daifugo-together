import { describe, expect, test } from 'vitest';

import { parseLastJsonLine, trafficWindow } from './dashboard-local.js';

describe('local operations dashboard', () => {
  test('flyctlの接続表示を除いて最後のJSONを読む', () => {
    expect(
      parseLastJsonLine<{ generatedAt: number }>(
        'Connecting to machine...\n{"generatedAt":1234}\n',
      ),
    ).toEqual({ generatedAt: 1234 });
    expect(() => parseLastJsonLine('Connecting only')).toThrow(
      'Fly.ioからJSON形式の集計結果を取得できませんでした',
    );
  });

  test('HTTPレスポンスとWebSocket接続をstatus別メトリクスから集計する', () => {
    expect(
      trafficWindow({
        status: 'success',
        data: {
          result: [
            { metric: { status: '101' }, value: [1_000, '3'] },
            { metric: { status: '200' }, value: [1_000, '74.2'] },
            { metric: { status: '301' }, value: [1_000, '1'] },
          ],
        },
      }),
    ).toEqual({
      responses: 78,
      websocketConnections: 3,
      byStatus: { '101': 3, '200': 74, '301': 1 },
    });
  });

  test('失敗したPrometheus応答を拒否する', () => {
    expect(() => trafficWindow({ status: 'error' })).toThrow(
      'Fly.ioのHTTPメトリクス応答が不正です',
    );
  });
});
