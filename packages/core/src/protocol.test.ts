import { describe, expect, it } from 'vitest';

import { clientPayloadSchemas } from './protocol.js';

describe('shared client payload schemas', () => {
  it('rejects extra keys for empty payload events', () => {
    for (const event of [
      'room:create',
      'room:leave',
      'room:start',
      'room:continue',
      'sync:request',
    ] as const) {
      expect(
        clientPayloadSchemas[event].safeParse({ extra: true }).success,
      ).toBe(false);
      expect(clientPayloadSchemas[event].safeParse({}).success).toBe(true);
    }
  });

  it('validates join, play, pass, and rename payloads', () => {
    expect(
      clientPayloadSchemas['room:join'].safeParse({ inviteCode: 123 }).success,
    ).toBe(false);
    expect(
      clientPayloadSchemas['game:play'].safeParse({
        turnSeq: -1,
        cards: [],
      }).success,
    ).toBe(false);
    expect(
      clientPayloadSchemas['game:pass'].safeParse({ turnSeq: 0.5 }).success,
    ).toBe(false);
    expect(
      clientPayloadSchemas['user:rename'].safeParse({
        displayName: '12345678901',
      }).success,
    ).toBe(false);
    expect(
      clientPayloadSchemas['user:rename'].parse({
        displayName: '  たろう  ',
      }),
    ).toEqual({ displayName: 'たろう' });
  });
});
