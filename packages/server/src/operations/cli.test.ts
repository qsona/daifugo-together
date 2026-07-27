import { describe, expect, test } from 'vitest';

import { nonNegativeIntegerOption, optionValue, parseSince } from './cli.js';

describe('operations CLI', () => {
  test('日付だけのsinceをJST 00:00として解釈する', () => {
    expect(parseSince('2026-08-01', Date.UTC(2026, 7, 2))).toBe(
      Date.parse('2026-08-01T00:00:00+09:00'),
    );
  });

  test('明示したoffsetを環境に依存せず解釈する', () => {
    expect(parseSince('2026-08-01T03:04:05+09:00', Date.UTC(2026, 7, 2))).toBe(
      Date.parse('2026-08-01T03:04:05+09:00'),
    );
    expect(parseSince('2026-07-31T18:04:05Z', Date.UTC(2026, 7, 2))).toBe(
      Date.parse('2026-07-31T18:04:05Z'),
    );
  });

  test('timezoneなし日時と存在しない日付を拒否する', () => {
    expect(() =>
      parseSince('2026-08-01T00:00:00', Date.UTC(2026, 7, 2)),
    ).toThrow('--since datetime must include Z or an explicit UTC offset');
    expect(() => parseSince('2026-02-30', Date.UTC(2026, 7, 2))).toThrow(
      '--since contains an invalid calendar date',
    );
    expect(() =>
      parseSince('2026-02-30T00:00:00Z', Date.UTC(2026, 7, 2)),
    ).toThrow('--since contains an invalid calendar date');
  });

  test('既定30日とCLI数値optionを解釈する', () => {
    const now = Date.UTC(2026, 7, 1);
    expect(parseSince(null, now)).toBe(now - 30 * 24 * 60 * 60 * 1_000);
    expect(optionValue(['status', '--limit', '50'], '--limit')).toBe('50');
    expect(
      nonNegativeIntegerOption(['status', '--offset', '20'], '--offset', 0),
    ).toBe(20);
    expect(() =>
      nonNegativeIntegerOption(
        ['status', '--limit', '1001'],
        '--limit',
        20,
        1000,
      ),
    ).toThrow('--limit must be an integer between 0 and 1000');
  });
});
