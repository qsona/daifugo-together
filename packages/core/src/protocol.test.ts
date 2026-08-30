import { describe, expect, it } from 'vitest';

import { clientPayloadSchemas } from './protocol.js';

describe('shared client payload schemas', () => {
  it('bounded integer rule input accepts safe integers only', () => {
    expect(
      clientPayloadSchemas['game:ruleInput'].safeParse({
        turnSeq: 3,
        choiceId: 'pass_count',
        value: 8,
      }).success,
    ).toBe(true);
    expect(
      clientPayloadSchemas['game:ruleInput'].safeParse({
        turnSeq: 3,
        choiceId: 'pass_count',
        value: 8.5,
      }).success,
    ).toBe(false);
  });

  it('rejects extra keys for empty payload events', () => {
    for (const event of [
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

  it('room:createはモード指定を受け、未指定も旧クライアント互換で受ける', () => {
    expect(clientPayloadSchemas['room:create'].safeParse({}).success).toBe(
      true,
    );
    expect(
      clientPayloadSchemas['room:create'].safeParse({ mode: 'basic' }).success,
    ).toBe(true);
    expect(
      clientPayloadSchemas['room:create'].safeParse({ mode: 'community' })
        .success,
    ).toBe(true);
    expect(
      clientPayloadSchemas['room:create'].safeParse({ mode: 'unknown' })
        .success,
    ).toBe(false);
    expect(
      clientPayloadSchemas['room:create'].safeParse({
        mode: 'basic',
        extra: true,
      }).success,
    ).toBe(false);
  });

  it('validates join, play, pass, and rename payloads', () => {
    expect(
      clientPayloadSchemas['room:join'].safeParse({ inviteCode: '01234' })
        .success,
    ).toBe(true);
    expect(
      clientPayloadSchemas['room:join'].safeParse({
        inviteCode: '01234',
        takeoverMemberId: 'ai-seat-1',
      }).success,
    ).toBe(true);
    expect(
      clientPayloadSchemas['room:join'].safeParse({
        inviteCode: '01234',
        takeoverMemberId: '',
      }).success,
    ).toBe(false);
    expect(
      clientPayloadSchemas['room:seatOptions'].safeParse({
        inviteCode: '01234',
      }).success,
    ).toBe(true);
    expect(
      clientPayloadSchemas['room:join'].safeParse({ inviteCode: 123 }).success,
    ).toBe(false);
    expect(
      clientPayloadSchemas['room:join'].safeParse({ inviteCode: '1234' })
        .success,
    ).toBe(false);
    expect(
      clientPayloadSchemas['room:join'].safeParse({ inviteCode: '12A45' })
        .success,
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

  it('game:play は最大14枚と optional kind を受け付ける', () => {
    const cards = Array.from({ length: 14 }, (_, index) => `C${index}`);
    expect(
      clientPayloadSchemas['game:play'].safeParse({ turnSeq: 0, cards })
        .success,
    ).toBe(true);
    expect(
      clientPayloadSchemas['game:play'].safeParse({
        turnSeq: 0,
        cards: [...cards, 'C14'],
      }).success,
    ).toBe(false);
    expect(
      clientPayloadSchemas['game:play'].safeParse({
        turnSeq: 0,
        cards: ['S07'],
        kind: 'sequence',
      }).success,
    ).toBe(true);
    expect(
      clientPayloadSchemas['game:play'].safeParse({
        turnSeq: 0,
        cards: ['S07'],
        kind: 'unknown',
      }).success,
    ).toBe(false);
  });
});
