import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  loadAdminTrafficDashboardWithToken,
  parseLastJsonLine,
  trafficWindow,
} from './dashboard-local.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  test('管理画面向けに30分・3時間・24時間の通信量を取得する', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toContain('/prometheus/personal/api/v1/query');
      return new Response(
        JSON.stringify({
          status: 'success',
          data: { result: [] },
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      loadAdminTrafficDashboardWithToken('daifugo', 'personal', 'token'),
    ).resolves.toEqual({
      windows: {
        last30m: { responses: 0, websocketConnections: 0, byStatus: {} },
        last3h: { responses: 0, websocketConnections: 0, byStatus: {} },
        last24h: { responses: 0, websocketConnections: 0, byStatus: {} },
      },
    });
    const queries = fetchMock.mock.calls.map(([input]) =>
      new URL(String(input)).searchParams.get('query'),
    );
    expect(queries).toEqual(
      expect.arrayContaining([
        expect.stringContaining('[1800s]'),
        expect.stringContaining('[10800s]'),
        expect.stringContaining('[86400s]'),
      ]),
    );
  });
});
