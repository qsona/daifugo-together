import { enumerateLegalPlays, type RuleChainEntry } from '@daifugo/core';
import { describe, expect, it } from 'vitest';

import { createRoomState, reduceRoom } from './reducer.js';
import type { RoomAction, RoomState } from './types.js';
import { viewFor } from './view.js';

function room(): RoomState {
  return createRoomState({
    roomId: 'room-1',
    inviteCode: '01234',
    mode: 'community',
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

function finishSet(initial: RoomState): {
  state: RoomState;
  acceptedActions: number;
} {
  let state = initial;
  let acceptedActions = 0;
  for (let guard = 0; guard < 5_000 && state.phase === 'playing'; guard += 1) {
    const engine = state.engine!;
    if (engine.phase.name === 'interimResult') {
      const advanced = reduceRoom(state, {
        type: 'advanceIntermission',
        now: 20_000 + guard,
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
    const transition =
      legal.length === 0
        ? reduceRoom(state, {
            type: 'pass',
            memberId: player,
            turnSeq: state.turnSeq,
            now: 20_000 + guard,
          })
        : reduceRoom(state, {
            type: 'play',
            memberId: player,
            turnSeq: state.turnSeq,
            cards: legal[0]!.cards.map((card) => card.id),
            now: 20_000 + guard,
          });
    expect(transition.accepted).toBe(true);
    state = transition.state;
    acceptedActions += 1;
  }
  return { state, acceptedActions };
}

describe('pure room reducer', () => {
  it('きほんの1人AI戦は人間のタイマーを外し、初戦だけ人間をseat 0に置く', () => {
    const basic = createRoomState({
      roomId: 'basic-tutorial',
      inviteCode: '01003',
      mode: 'basic',
      owner: {
        memberId: 'member-1',
        userId: 'private-user-1',
        displayName: 'ホスト',
      },
      now: 100,
    });
    const started = reduceRoom(
      basic,
      {
        type: 'start',
        memberId: 'member-1',
        now: 1_000,
        setSeed: 'v3a-1',
      },
      { random: () => 0 },
    ).state;

    expect(
      started.members.find((member) => member.memberId === 'member-1')?.seatId,
    ).toBe(0);
    expect(started.engine?.currentGame?.public.turn).toBe('member-1');
    expect(started.turnDeadlineAt).toBeNull();

    const disconnected = reduceRoom(
      started,
      { type: 'disconnect', memberId: 'member-1', now: 2_000 },
      { random: () => 0 },
    ).state;
    expect(disconnected.turnDeadlineAt).toBe(17_000);
  });

  it('きほんでも人間2人なら通常タイマーを残し、communityの席順は従来どおりシャッフルする', () => {
    const basicTwoHumans = createRoomState({
      roomId: 'basic-multi',
      inviteCode: '02003',
      mode: 'basic',
      owner: {
        memberId: 'member-1',
        userId: 'private-user-1',
        displayName: 'ホスト',
      },
      now: 100,
    });
    const joined = join(basicTwoHumans, 2);
    const basicStarted = reduceRoom(
      joined,
      {
        type: 'start',
        memberId: 'member-1',
        now: 1_000,
        setSeed: 'v3a-1',
      },
      { random: () => 0.999_999 },
    ).state;
    expect(basicStarted.engine?.currentGame?.public.turn).toBe('member-1');
    expect(basicStarted.turnDeadlineAt).toBe(61_000);

    const communityStarted = reduceRoom(
      room(),
      {
        type: 'start',
        memberId: 'member-1',
        now: 1_000,
        setSeed: 'v3a-1',
      },
      { random: () => 0 },
    ).state;
    expect(
      communityStarted.members.find((member) => member.memberId === 'member-1')
        ?.seatId,
    ).not.toBe(0);
  });

  it('basic soloでも2セット目は人間をseat 0へ固定しない', () => {
    const secondSet = {
      ...createRoomState({
        roomId: 'basic-second-set',
        inviteCode: '03003',
        mode: 'basic' as const,
        owner: {
          memberId: 'member-1',
          userId: 'private-user-1',
          displayName: 'ホスト',
        },
        now: 100,
      }),
      setNo: 1,
    };
    const started = reduceRoom(
      secondSet,
      {
        type: 'start',
        memberId: 'member-1',
        now: 1_000,
        setSeed: 'v3a-second',
      },
      { random: () => 0 },
    ).state;

    expect(
      started.members.find((member) => member.memberId === 'member-1')?.seatId,
    ).not.toBe(0);
  });

  it('モードをstate/viewへ通し、きほんでは入力されたルールを空にする', () => {
    const availableRule: RuleChainEntry = {
      ruleId: 'community-rule',
      name: 'みんなのルール',
      position: 0,
      priority: {
        score: 1,
        activatedAt: 1,
        ruleId: 'community-rule',
      },
      bundleHash: 'fixture',
      contractVersion: 1,
    };
    const basic = createRoomState({
      roomId: 'basic-room',
      inviteCode: '00001',
      mode: 'basic',
      owner: {
        memberId: 'basic-owner',
        userId: 'basic-user',
        displayName: 'ホスト',
      },
      availableRules: [availableRule],
      now: 100,
    });

    expect(basic.mode).toBe('basic');
    expect(basic.availableRules).toEqual([]);
    expect(viewFor(basic, 'basic-owner').mode).toBe('basic');
    expect(viewFor(basic, 'basic-owner').activeRules).toEqual([]);
  });

  it('drain要求は進行中ゲームを完走させ、新しいゲームを開始せずsetResultへ移る', () => {
    const state = start(fourHumanRoom());
    const drained = reduceRoom(state, {
      type: 'requestDrain',
      now: 2_000,
    });

    expect(drained.accepted).toBe(true);
    expect(drained.state.phase).toBe('playing');
    expect(drained.state.engine?.draining).toBe(true);
    expect(drained.state.turnDeadlineAt).toBe(state.turnDeadlineAt);

    const finished = finishSet(drained.state).state;
    expect(finished.phase).toBe('setResult');
    expect(finished.engine?.results).toHaveLength(1);
    expect(finished.setRespondBy).not.toBeNull();
  });

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

  it('ゲーム間リザルトの既定15秒と同じ終了時刻をsnapshotへ載せる', () => {
    const started = start(room());
    expect(started.engine?.config.interimAutoAdvanceMs).toBe(15_000);

    const intermission: RoomState = {
      ...started,
      engine: {
        ...started.engine!,
        phase: { name: 'interimResult', gameIndex: 0 },
      },
      intermissionEndsAt: 42_000,
      turnDeadlineAt: null,
    };
    expect(viewFor(intermission, 'member-1').game?.intermission).toEqual({
      durationMs: 15_000,
      endsAt: 42_000,
      ready: false,
    });
  });

  it('人間が1人なら準備完了を押すとすぐ次戦を始める', () => {
    const started = start(room());
    const intermission: RoomState = {
      ...started,
      engine: {
        ...started.engine!,
        phase: { name: 'interimResult', gameIndex: 0 },
      },
      intermissionEndsAt: 16_000,
      turnDeadlineAt: null,
    };

    const ready = reduceRoom(intermission, {
      type: 'readyIntermission',
      memberId: 'member-1',
      now: 2_000,
    });

    expect(ready.accepted).toBe(true);
    expect(ready.state.engine?.phase).toEqual({
      name: 'gameInProgress',
      gameIndex: 1,
    });
    expect(ready.state.intermissionEndsAt).toBeNull();
    expect(ready.state.intermissionReadyMemberIds).toEqual([]);
  });

  it('人間が複数なら全員の準備完了を待ち、元の15秒期限を維持する', () => {
    const started = start(join(room(), 2));
    const intermission: RoomState = {
      ...started,
      engine: {
        ...started.engine!,
        phase: { name: 'interimResult', gameIndex: 0 },
      },
      intermissionEndsAt: 16_000,
      turnDeadlineAt: null,
    };

    const first = reduceRoom(intermission, {
      type: 'readyIntermission',
      memberId: 'member-1',
      now: 2_000,
    });
    expect(first.accepted).toBe(true);
    expect(first.state.engine?.phase.name).toBe('interimResult');
    expect(first.state.intermissionEndsAt).toBe(16_000);
    expect(viewFor(first.state, 'member-1').game?.intermission?.ready).toBe(
      true,
    );
    expect(viewFor(first.state, 'member-2').game?.intermission?.ready).toBe(
      false,
    );

    const second = reduceRoom(first.state, {
      type: 'readyIntermission',
      memberId: 'member-2',
      now: 3_000,
    });
    expect(second.accepted).toBe(true);
    expect(second.state.engine?.phase).toEqual({
      name: 'gameInProgress',
      gameIndex: 1,
    });
    expect(second.state.intermissionEndsAt).toBeNull();
  });

  it('待機中のホスト離脱で参加順に移譲し、最後の人間離脱で閉じる', () => {
    const joined = join(room(), 2);
    const hostLeft = reduceRoom(joined, {
      type: 'leave',
      memberId: 'member-1',
      now: 200,
      setSeed: 'unused',
    });
    expect(hostLeft.accepted).toBe(true);
    expect(hostLeft.state.members).toHaveLength(1);
    expect(hostLeft.state.members[0]).toMatchObject({
      memberId: 'member-2',
      isHost: true,
    });
    expect(hostLeft.events.map((event) => event.t)).toEqual([
      'memberLeft',
      'hostChanged',
    ]);

    const empty = reduceRoom(hostLeft.state, {
      type: 'leave',
      memberId: 'member-2',
      now: 201,
      setSeed: 'unused',
    });
    expect(empty.state.phase).toBe('closed');
    expect(empty.state.members).toEqual([]);
  });

  it('waiting切断者を60秒後に解放してhost移譲し、lobby TTLで部屋を閉じる', () => {
    const joined = join(room(), 2);
    const disconnected = reduceRoom(joined, {
      type: 'disconnect',
      memberId: 'member-1',
      now: 1_000,
    }).state;
    const early = reduceRoom(disconnected, {
      type: 'expireWaitingMember',
      memberId: 'member-1',
      expectedAt: 61_000,
      now: 60_999,
      setSeed: 'unused',
    });
    expect(early.error?.code).toBe('INVALID_SET_PHASE');

    const released = reduceRoom(disconnected, {
      type: 'expireWaitingMember',
      memberId: 'member-1',
      expectedAt: 61_000,
      now: 61_000,
      setSeed: 'unused',
    });
    expect(released.accepted).toBe(true);
    expect(released.state.members).toHaveLength(1);
    expect(released.state.members[0]).toMatchObject({
      memberId: 'member-2',
      isHost: true,
    });

    const expired = reduceRoom(released.state, {
      type: 'expireRoom',
      reason: 'lobbyExpired',
      expectedAt: released.state.lobbyExpiresAt,
      now: released.state.lobbyExpiresAt,
    });
    expect(expired.state.phase).toBe('closed');
    expect(expired.state.members).toEqual([]);
  });

  it('playingで接続中人間が0になると5分後にabandonし、復帰すれば解除する', () => {
    const started = start(room());
    const disconnected = reduceRoom(started, {
      type: 'disconnect',
      memberId: 'member-1',
      now: 2_000,
    }).state;
    expect(disconnected.abandonAt).toBe(302_000);

    const early = reduceRoom(disconnected, {
      type: 'expireRoom',
      reason: 'abandoned',
      expectedAt: 302_000,
      now: 301_999,
    });
    expect(early.error?.code).toBe('INVALID_SET_PHASE');
    const reconnected = reduceRoom(disconnected, {
      type: 'reconnect',
      memberId: 'member-1',
      now: 3_000,
    }).state;
    expect(reconnected.abandonAt).toBeNull();
    expect(
      reduceRoom(reconnected, {
        type: 'expireRoom',
        reason: 'abandoned',
        expectedAt: 302_000,
        now: 302_000,
      }).error?.code,
    ).toBe('INVALID_SET_PHASE');

    const abandoned = reduceRoom(disconnected, {
      type: 'expireRoom',
      reason: 'abandoned',
      expectedAt: 302_000,
      now: 302_000,
    });
    expect(abandoned.state.phase).toBe('closed');
    expect(abandoned.state.members).toEqual([]);
  });

  it('対局中の切断は席を保ったAI代行、復帰はhumanへ戻し、明示離脱は不可逆にする', () => {
    const started = start(join(room(), 2));
    const disconnected = reduceRoom(started, {
      type: 'disconnect',
      memberId: 'member-2',
      now: 1_500,
    });
    expect(disconnected.state.members).toContainEqual(
      expect.objectContaining({
        memberId: 'member-2',
        connected: false,
        controller: 'ai',
        aiActing: true,
        departed: false,
      }),
    );
    expect(disconnected.events.map((event) => event.t)).toEqual([
      'memberDisconnected',
      'aiTakeover',
    ]);

    const reconnected = reduceRoom(disconnected.state, {
      type: 'reconnect',
      memberId: 'member-2',
      now: 1_600,
    });
    expect(reconnected.state.members).toContainEqual(
      expect.objectContaining({
        memberId: 'member-2',
        connected: true,
        controller: 'human',
        aiActing: false,
        departed: false,
      }),
    );

    const left = reduceRoom(reconnected.state, {
      type: 'leave',
      memberId: 'member-2',
      now: 2_000,
      setSeed: 'unused',
    });
    expect(left.state.members).toContainEqual(
      expect.objectContaining({
        memberId: 'member-2',
        seatId: expect.any(Number),
        controller: 'ai',
        aiActing: true,
        departed: true,
      }),
    );
    expect(
      reduceRoom(left.state, {
        type: 'reconnect',
        memberId: 'member-2',
        now: 2_001,
      }).error?.code,
    ).toBe('NOT_IN_ROOM');
  });

  it('開始時に切断中の人間も席数へ含め、その席をAI代行にする', () => {
    const joined = join(room(), 2);
    const disconnected = reduceRoom(joined, {
      type: 'disconnect',
      memberId: 'member-2',
      now: 500,
    }).state;
    const started = start(disconnected);
    expect(started.members.filter((member) => member.isAI)).toHaveLength(2);
    expect(started.members).toContainEqual(
      expect.objectContaining({
        memberId: 'member-2',
        isAI: false,
        connected: false,
        controller: 'ai',
        aiActing: true,
      }),
    );
  });

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

  it('2席playと手番timeoutの三つ巴でも、同じturnSeqを1件だけ適用する', () => {
    const permutations = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];
    for (const order of permutations) {
      let state = start(fourHumanRoom());
      const game = state.engine!.currentGame!;
      const current = game.public.turn!;
      const other = state.members.find(
        (member) => member.memberId !== current,
      )!.memberId;
      const lead = game.players[current]!.hand.find(
        (card) => card.id === 'D03',
      )!;
      const otherCard = game.players[other]!.hand[0]!;
      const actions: RoomAction[] = [
        {
          type: 'play',
          memberId: current,
          turnSeq: state.turnSeq,
          cards: [lead.id],
          now: 3_000,
        },
        {
          type: 'play',
          memberId: other,
          turnSeq: state.turnSeq,
          cards: [otherCard.id],
          now: 3_000,
        },
        {
          type: 'autoAct',
          memberId: current,
          turnSeq: state.turnSeq,
          cards: [lead.id],
          reason: 'turnTimeout',
          now: 3_000,
        },
      ];
      let accepted = 0;
      for (const index of order) {
        const transition = reduceRoom(state, actions[index]!);
        if (transition.accepted) accepted += 1;
        state = transition.state;
      }
      expect(accepted).toBe(1);
      expect(state.turnSeq).toBe(1);
      const finalGame = state.engine!.currentGame!;
      const cardCount =
        Object.values(finalGame.players).reduce(
          (total, player) => total + player.hand.length,
          0,
        ) + (finalGame.public.field.current?.play.cards.length ?? 0);
      expect(cardCount).toBe(52);
    }
  });

  it('人間手番の期限を接続状態に合わせ、autoActだけturnTimeoutを公開する', () => {
    const started = start(fourHumanRoom());
    const player = started.engine!.currentGame!.public.turn!;
    expect(started.turnDeadlineAt).toBe(61_000);

    const disconnected = reduceRoom(started, {
      type: 'disconnect',
      memberId: player,
      now: 2_000,
    });
    expect(disconnected.state.turnDeadlineAt).toBe(17_000);
    const reconnected = reduceRoom(disconnected.state, {
      type: 'reconnect',
      memberId: player,
      now: 3_000,
    });
    expect(reconnected.state.turnDeadlineAt).toBe(63_000);

    const game = reconnected.state.engine!.currentGame!;
    const legal = enumerateLegalPlays(
      {
        gameIndex: 0,
        seats: reconnected.state.engine!.members.map((member) => member.id),
        gameSeed: `${reconnected.state.engine!.setSeed}:0`,
        ruleChain: reconnected.state.engine!.ruleChain,
      },
      game,
      player,
    );
    const automated = reduceRoom(reconnected.state, {
      type: 'autoAct',
      memberId: player,
      turnSeq: reconnected.state.turnSeq,
      cards: legal[0]?.cards.map((card) => card.id) ?? null,
      reason: 'turnTimeout',
      now: 63_000,
    });
    expect(automated.accepted).toBe(true);
    expect(automated.state.turnSeq).toBe(reconnected.state.turnSeq + 1);
    expect(automated.events.map((event) => event.t)).toContain('turnTimeout');
  });

  it('表示名は空白除去後1〜10文字に制限する', () => {
    const accepted = reduceRoom(room(), {
      type: 'rename',
      memberId: 'member-1',
      displayName: '  １２３４５６７８９０  ',
    });
    expect(accepted.accepted).toBe(true);
    expect(accepted.state.members[0]?.displayName).toBe('１２３４５６７８９０');

    const tooLong = reduceRoom(accepted.state, {
      type: 'rename',
      memberId: 'member-1',
      displayName: '１２３４５６７８９０１',
    });
    expect(tooLong.error?.code).toBe('INVALID_NAME');
    expect(tooLong.state).toBe(accepted.state);
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
          now: 10_000 + guard,
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

  it('完走セットのビューは最終戦の順位と順位点を持ち、中断セットでは持たない', () => {
    const completed = finishSet(start(fourHumanRoom())).state;

    expect(completed.engine?.outcome?.completion).toBe('completed');
    const finalGame = viewFor(completed, 'member-1').setResult?.finalGame;
    expect(finalGame?.gameNo).toBe(3);
    expect(finalGame?.standings.map((standing) => standing.rank)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(finalGame?.standings.map((standing) => standing.points)).toEqual([
      5, 3, 2, 1,
    ]);
    expect(finalGame?.standings[0]?.title).toBe('大富豪');

    const draining = reduceRoom(start(fourHumanRoom()), {
      type: 'requestDrain',
      now: 2_000,
    }).state;
    const drained = finishSet(draining).state;

    expect(drained.engine?.outcome?.completion).toBe('drained');
    expect(drained.engine?.results).toHaveLength(1);
    expect(viewFor(drained, 'member-1').setResult?.finalGame).toBeNull();
  });

  it('setResult到達時に切断中・明示離脱済みの人間を除去し、接続中の人間は残す', () => {
    const started = start(join(join(room(), 2), 3));
    const withDeparture = reduceRoom(started, {
      type: 'leave',
      memberId: 'member-1',
      now: 2_000,
      setSeed: 'unused',
    }).state;
    const disconnected = reduceRoom(withDeparture, {
      type: 'disconnect',
      memberId: 'member-2',
      now: 2_001,
    }).state;
    const finished = finishSet(disconnected).state;

    expect(finished.phase).toBe('setResult');
    expect(
      finished.members.some(
        (member) =>
          member.memberId === 'member-1' || member.memberId === 'member-2',
      ),
    ).toBe(false);
    expect(
      finished.lastEvents.flatMap((event) =>
        event.t === 'memberLeft' ? [event.memberId] : [],
      ),
    ).toContain('member-2');
    expect(finished.members).toContainEqual(
      expect.objectContaining({
        memberId: 'member-3',
        connected: true,
        departed: false,
      }),
    );
  });

  it('残留人間全員のcontinueを待ち、AIを取り直して新しいセットを開始する', () => {
    const finished = finishSet(start(join(room(), 2))).state;
    expect(finished.phase).toBe('setResult');

    const first = reduceRoom(
      finished,
      {
        type: 'continue',
        memberId: 'member-1',
        now: 50_000,
        setSeed: 'next-set',
      },
      { random: () => 0.999_999 },
    );
    expect(first.accepted).toBe(true);
    expect(first.state.phase).toBe('setResult');
    expect(
      first.state.members.find((member) => member.memberId === 'member-1')
        ?.wantsNextSet,
    ).toBe(true);
    expect(
      first.state.members.find((member) => member.memberId === 'member-2')
        ?.wantsNextSet,
    ).toBe(false);

    const second = reduceRoom(
      first.state,
      {
        type: 'continue',
        memberId: 'member-2',
        now: 50_001,
        setSeed: 'next-set',
      },
      { random: () => 0.999_999 },
    );
    expect(second.accepted).toBe(true);
    expect(second.state.phase).toBe('playing');
    expect(second.state.setNo).toBe(2);
    expect(second.state.members).toHaveLength(4);
    expect(second.state.members.filter((member) => member.isAI)).toHaveLength(
      2,
    );
    expect(
      second.state.members.every(
        (member) => member.wantsNextSet === member.isAI,
      ),
    ).toBe(true);
    expect(second.state.engine?.results).toEqual([]);
    expect(second.state.engine?.setSeed).toBe('next-set');
  });

  it('setResultで継続しない人が離脱すると、継続者だけで次セットを始める', () => {
    const finished = finishSet(start(join(room(), 2))).state;
    const waiting = reduceRoom(finished, {
      type: 'continue',
      memberId: 'member-1',
      now: 50_000,
      setSeed: 'unused-until-ready',
    }).state;
    const left = reduceRoom(
      waiting,
      {
        type: 'leave',
        memberId: 'member-2',
        now: 50_001,
        setSeed: 'after-leave',
      },
      { random: () => 0.999_999 },
    );

    expect(left.state.phase).toBe('playing');
    expect(left.state.setNo).toBe(2);
    expect(
      left.state.members
        .filter((member) => !member.isAI)
        .map((member) => member.memberId),
    ).toEqual(['member-1']);
    expect(left.state.members.filter((member) => member.isAI)).toHaveLength(3);
    expect(left.state.engine?.setSeed).toBe('after-leave');
  });

  it('setResult期限で無応答者を除外し、継続者0なら閉じる', () => {
    const finished = finishSet(start(join(room(), 2))).state;
    const deadline = finished.setRespondBy!;
    const early = reduceRoom(finished, {
      type: 'expireSetResult',
      now: deadline - 1,
      setSeed: 'too-early',
    });
    expect(early.error?.code).toBe('INVALID_SET_PHASE');
    expect(early.state).toBe(finished);

    const expired = reduceRoom(finished, {
      type: 'expireSetResult',
      now: deadline,
      setSeed: 'nobody-continues',
    });
    expect(expired.accepted).toBe(true);
    expect(expired.state.phase).toBe('closed');
    expect(expired.state.members).toEqual([]);
  });

  it('snapshotと公開eventを変更してもRoom/Core権威状態を変更できない', () => {
    const started = start(fourHumanRoom());
    const viewer = started.engine!.currentGame!.public.turn!;
    const snapshot = viewFor(started, viewer);
    const ownCard = snapshot.game!.yourHand[0]!;
    const originalOwnId = ownCard.id;
    ownCard.id = 'MUTATED_VIEW';
    expect(
      started.engine!.currentGame!.players[viewer]!.hand.some(
        (card) => card.id === originalOwnId,
      ),
    ).toBe(true);
    expect(
      started.engine!.currentGame!.players[viewer]!.hand.some(
        (card) => card.id === 'MUTATED_VIEW',
      ),
    ).toBe(false);

    const leadCard = started.engine!.currentGame!.players[viewer]!.hand.find(
      (card) => card.id === 'D03',
    )!;
    const played = reduceRoom(started, {
      type: 'play',
      memberId: viewer,
      turnSeq: started.turnSeq,
      cards: [leadCard.id],
      now: 3_000,
    });
    const outputEvent = played.events.find((event) => event.t === 'played');
    const stateEvent = played.state.lastEvents.find(
      (event) => event.t === 'played',
    );
    expect(outputEvent?.t).toBe('played');
    expect(stateEvent?.t).toBe('played');
    if (outputEvent?.t === 'played' && stateEvent?.t === 'played') {
      outputEvent.cards[0]!.id = 'MUTATED_OUTPUT_EVENT';
      expect(stateEvent.cards[0]!.id).toBe('D03');
      stateEvent.cards[0]!.id = 'MUTATED_STATE_EVENT';
    }
    expect(
      played.state.engine!.currentGame!.public.field.current!.play.cards[0]!.id,
    ).toBe('D03');
  });
});

describe('per-player room view allow-list', () => {
  it('異なるseedと合法手選択で生成した多数局面でも、他席の手札を漏らさない', () => {
    for (let sample = 0; sample < 16; sample += 1) {
      let state = reduceRoom(
        fourHumanRoom(),
        {
          type: 'start',
          memberId: 'member-1',
          now: 1_000,
          setSeed: `leak-property-${sample}`,
        },
        {
          gamesPerSet: 1,
          random: () => ((sample * 37 + 11) % 101) / 101,
        },
      ).state;

      for (let step = 0; step < 400 && state.phase === 'playing'; step += 1) {
        expectNoOtherHands(state);
        const engine = state.engine!;
        if (engine.phase.name === 'interimResult') {
          state = reduceRoom(state, {
            type: 'advanceIntermission',
            now: 2_000 + step,
          }).state;
          continue;
        }
        if (engine.phase.name !== 'gameInProgress') {
          throw new Error('Room phase did not follow the set phase');
        }
        const game = engine.currentGame!;
        const memberId = game.public.turn!;
        const legal = enumerateLegalPlays(
          {
            gameIndex: engine.phase.gameIndex,
            seats: engine.members.map((member) => member.id),
            gameSeed: `${engine.setSeed}:${engine.phase.gameIndex}`,
            ruleChain: engine.ruleChain,
          },
          game,
          memberId,
        );
        const choice =
          legal[(sample * 17 + step * 13) % Math.max(legal.length, 1)];
        state = (
          choice
            ? reduceRoom(state, {
                type: 'play',
                memberId,
                turnSeq: state.turnSeq,
                cards: choice.cards.map((card) => card.id),
                now: 2_000 + step,
              })
            : reduceRoom(state, {
                type: 'pass',
                memberId,
                turnSeq: state.turnSeq,
                now: 2_000 + step,
              })
        ).state;
      }
      expect(state.phase).toBe('setResult');
      expectNoOtherHands(state);
    }
  }, 15_000);

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
