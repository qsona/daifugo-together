import { enumerateLegalPlays } from '@daifugo/core';
import { describe, expect, it } from 'vitest';

import { createRoomState, reduceRoom } from './reducer.js';
import type { RoomState } from './types.js';
import { viewFor } from './view.js';

function room(): RoomState {
  return createRoomState({
    roomId: 'room-1',
    inviteCode: 'ABCD-2345',
    owner: {
      memberId: 'member-1',
      userId: 'private-user-1',
      displayName: 'ホスト',
    },
    now: 100,
  });
}

function join(state: RoomState, index: number): RoomState {
  const transition = reduceRoom(state, {
    type: 'join',
    member: {
      memberId: `member-${index}`,
      userId: `private-user-${index}`,
      displayName: `プレイヤー${index}`,
    },
    now: 100 + index,
  });
  expect(transition.accepted).toBe(true);
  return transition.state;
}

function fourHumanRoom(): RoomState {
  return join(join(join(room(), 2), 3), 4);
}

function start(state: RoomState): RoomState {
  const transition = reduceRoom(
    state,
    {
      type: 'start',
      memberId: 'member-1',
      now: 1_000,
      setSeed: 'room-set-seed',
    },
    { random: () => 0.999_999 },
  );
  expect(transition.accepted).toBe(true);
  return transition.state;
}

function allStrings(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(allStrings);
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => [
      key,
      ...allStrings(child),
    ]);
  }
  return [];
}

function expectNoOtherHands(state: RoomState): void {
  const game = state.engine?.currentGame;
  if (!game) {
    return;
  }
  for (const viewer of state.members) {
    const strings = new Set(allStrings(viewFor(state, viewer.memberId)));
    for (const other of state.members) {
      if (other.memberId === viewer.memberId) {
        continue;
      }
      for (const card of game.players[other.memberId]?.hand ?? []) {
        expect(strings.has(card.id)).toBe(false);
      }
    }
  }
}

describe('pure room reducer', () => {
  it('参加を直列化し、4人上限・重複・ホスト権限を強制する', () => {
    const state = fourHumanRoom();
    expect(state.v).toBe(4);
    expect(state.members.map((member) => member.memberId)).toEqual([
      'member-1',
      'member-2',
      'member-3',
      'member-4',
    ]);

    const full = reduceRoom(state, {
      type: 'join',
      member: {
        memberId: 'member-5',
        userId: 'private-user-5',
        displayName: '満員',
      },
      now: 200,
    });
    expect(full).toMatchObject({
      accepted: false,
      error: { code: 'ROOM_FULL' },
    });
    expect(full.state).toBe(state);

    const duplicate = reduceRoom(state, {
      type: 'join',
      member: {
        memberId: 'member-other',
        userId: 'private-user-2',
        displayName: '重複',
      },
      now: 201,
    });
    expect(duplicate.error?.code).toBe('ALREADY_IN_ROOM');

    const nonHost = reduceRoom(state, {
      type: 'start',
      memberId: 'member-2',
      now: 300,
      setSeed: 'ignored',
    });
    expect(nonHost.error?.code).toBe('NOT_HOST');
    expect(nonHost.state).toBe(state);
  });

  it.each([
    { humans: 1, expectedAi: 3 },
    { humans: 2, expectedAi: 2 },
    { humans: 3, expectedAi: 1 },
    { humans: 4, expectedAi: 0 },
  ])(
    '人間$humans人なら不足分$expectedAi席だけAIで補充する',
    ({ humans, expectedAi }) => {
      let state = room();
      for (let index = 2; index <= humans; index += 1) {
        state = join(state, index);
      }
      const started = start(state);

      expect(started.phase).toBe('playing');
      expect(started.members).toHaveLength(4);
      expect(started.members.filter((member) => member.isAI)).toHaveLength(
        expectedAi,
      );
      expect(new Set(started.members.map((member) => member.seatId))).toEqual(
        new Set([0, 1, 2, 3]),
      );
      expect(
        started.members.every(
          (member) => member.controller === (member.isAI ? 'ai' : 'human'),
        ),
      ).toBe(true);
      expect(started.fixedRules).toEqual([]);
      expect(started.engine).not.toBeNull();
    },
  );

  it('手番→turnSeq→core合法性の順に検証し、受理時だけ単調増加する', () => {
    const started = start(fourHumanRoom());
    const turn = started.engine?.currentGame?.public.turn;
    expect(turn).toBeTruthy();
    const player = started.engine?.currentGame?.players[turn!];
    const leadCard = player?.hand.find((card) => card.id === 'D03');
    expect(leadCard).toBeTruthy();

    const wrongSeat = reduceRoom(started, {
      type: 'play',
      memberId:
        started.members.find((member) => member.memberId !== turn)?.memberId ??
        '',
      turnSeq: started.turnSeq + 99,
      cards: [leadCard!.id],
      now: 2_000,
    });
    expect(wrongSeat.error?.code).toBe('NOT_YOUR_TURN');

    const stale = reduceRoom(started, {
      type: 'play',
      memberId: turn!,
      turnSeq: started.turnSeq + 1,
      cards: [leadCard!.id],
      now: 2_000,
    });
    expect(stale.error?.code).toBe('STALE_TURN');
    expect(stale.state.turnSeq).toBe(started.turnSeq);
    expect(stale.state.v).toBe(started.v);

    const illegal = reduceRoom(started, {
      type: 'play',
      memberId: turn!,
      turnSeq: started.turnSeq,
      cards: ['card-not-in-hand'],
      now: 2_000,
    });
    expect(illegal.error?.code).toBe('ILLEGAL_PLAY');
    expect(illegal.state.turnSeq).toBe(started.turnSeq);

    const accepted = reduceRoom(started, {
      type: 'play',
      memberId: turn!,
      turnSeq: started.turnSeq,
      cards: [leadCard!.id],
      now: 2_000,
    });
    expect(accepted.accepted).toBe(true);
    expect(accepted.state.turnSeq).toBe(started.turnSeq + 1);
    expect(accepted.state.v).toBe(started.v + 1);

    const duplicate = reduceRoom(accepted.state, {
      type: 'play',
      memberId: turn!,
      turnSeq: started.turnSeq,
      cards: [leadCard!.id],
      now: 2_001,
    });
    expect(duplicate.error?.code).toBe('NOT_YOUR_TURN');
    expect(duplicate.state).toBe(accepted.state);
  });

  it('Room経由で3ゲームを完走し、全着手で版・連番・手札秘匿を維持する', () => {
    let state = start(room());
    let acceptedActions = 0;
    for (
      let guard = 0;
      guard < 5_000 && state.phase !== 'setResult';
      guard += 1
    ) {
      expectNoOtherHands(state);
      const engine = state.engine!;
      if (engine.phase.name === 'interimResult') {
        const advanced = reduceRoom(state, {
          type: 'advanceIntermission',
        });
        expect(advanced.accepted).toBe(true);
        state = advanced.state;
        continue;
      }
      if (engine.phase.name === 'setResult') {
        throw new Error('Room phase did not follow the set phase');
      }
      const game = engine.currentGame!;
      const player = game.public.turn!;
      const legal = enumerateLegalPlays(
        {
          gameIndex: engine.phase.gameIndex,
          seats: engine.members.map((member) => member.id),
          gameSeed: `${engine.setSeed}:${engine.phase.gameIndex}`,
          ruleChain: engine.ruleChain,
        },
        game,
        player,
      );
      const beforeVersion = state.v;
      const beforeTurnSeq = state.turnSeq;
      const transition =
        legal.length === 0
          ? reduceRoom(state, {
              type: 'pass',
              memberId: player,
              turnSeq: beforeTurnSeq,
              now: 10_000 + guard,
            })
          : reduceRoom(state, {
              type: 'play',
              memberId: player,
              turnSeq: beforeTurnSeq,
              cards: legal[0]!.cards.map((card) => card.id),
              now: 10_000 + guard,
            });
      expect(transition.error).toBeUndefined();
      expect(transition.accepted).toBe(true);
      expect(transition.state.v).toBe(beforeVersion + 1);
      expect(transition.state.turnSeq).toBe(beforeTurnSeq + 1);
      state = transition.state;
      acceptedActions += 1;
    }

    expect(state.phase).toBe('setResult');
    expect(state.engine?.results).toHaveLength(3);
    expect(state.engine?.outcome?.completion).toBe('completed');
    expect(state.turnSeq).toBe(acceptedActions);
    expectNoOtherHands(state);
  });
});

describe('per-player room view allow-list', () => {
  it('本人の手札だけを含み、他人のuserId・Core private・内部ルール情報を配信しない', () => {
    const started = start(fourHumanRoom());
    const game = started.engine?.currentGame;
    expect(game).not.toBeNull();

    expectNoOtherHands(started);
    for (const viewer of started.members) {
      const view = viewFor(started, viewer.memberId);
      const strings = new Set(allStrings(view));
      const ownIds = new Set(
        game?.players[viewer.memberId]?.hand.map((card) => card.id) ?? [],
      );
      for (const cardId of ownIds) {
        expect(strings.has(cardId)).toBe(true);
      }

      expect(strings.has('private-user-1')).toBe(false);
      expect(strings.has('private-user-2')).toBe(false);
      expect(strings.has('private-user-3')).toBe(false);
      expect(strings.has('private-user-4')).toBe(false);
      expect(strings.has('engine')).toBe(false);
      expect(strings.has('private')).toBe(false);
      expect(strings.has('memory')).toBe(false);
      expect(strings.has('rng')).toBe(false);
      expect(strings.has('legalPlays')).toBe(false);
      expect(view.members.every((member) => member.handCount !== null)).toBe(
        true,
      );
    }
  });

  it('復帰用全量snapshotでは演出eventsを必ず空にする', () => {
    const started = start(room());
    expect(viewFor(started, 'member-1').events.length).toBeGreaterThan(0);
    expect(viewFor(started, 'member-1', { reconnect: true }).events).toEqual(
      [],
    );
  });
});
