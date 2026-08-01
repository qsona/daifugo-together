import {
  buildPlayerSnapshot,
  createDeck,
  createInProcessRuleChainPort,
  enumerateLegalPlays,
  reduceGame,
  startGame,
  type Card,
  type GameConfig,
  type GameState,
  type RuleChainEntry,
  type RuleModule,
  type RuleRuntime,
} from '@daifugo/core';
import { loadRuleCodeBundles } from '@daifugo/rules';
import { beforeAll, describe, expect, it } from 'vitest';

import { createRoomState, reduceRoom } from './reducer.js';
import { gameStatusViews } from './statuses.js';
import type { RoomState } from './types.js';
import { viewFor } from './view.js';

const REVOLUTION = 'r0003-kakumei';
const ELEVEN_BACK = 'r0005-eleven-back';
const BINDING = 'r0008-shibari-double-shibari';
const SEATS = ['p1', 'p2', 'p3', 'p4'];

const CARD_BY_ID = new Map(
  createDeck(['jokers']).map((card) => [card.id, card] as const),
);

const modules = new Map<string, RuleModule>();

beforeAll(async () => {
  for (const bundle of await loadRuleCodeBundles()) {
    modules.set(bundle.module.meta.ruleId, bundle.module);
  }
});

function entry(
  ruleId: string,
  name: string,
  position: number,
  engineFeatures?: readonly ('jokers' | 'sequence')[],
): RuleChainEntry {
  return {
    ruleId,
    name,
    position,
    priority: {
      score: 0,
      activatedAt: Date.parse('2026-07-26T00:00:00.000Z'),
      ruleId,
    },
    bundleHash: 'fixture',
    contractVersion: 1,
    ...(engineFeatures === undefined ? {} : { engineFeatures }),
  };
}

const REVOLUTION_ENTRY = entry(REVOLUTION, '革命', 0);
const ELEVEN_BACK_ENTRY = entry(ELEVEN_BACK, 'イレブンバック', 1);
const BINDING_ENTRY = entry(BINDING, 'しばり', 2);
/** ジョーカー入りの山にするためだけの宣言。対応するルールモジュールは登録しない。 */
const JOKER_ENTRY = entry('fixture-jokers', 'ジョーカー', 3, ['jokers']);

function runtime(ruleChain: readonly RuleChainEntry[]): RuleRuntime {
  return {
    port: createInProcessRuleChainPort(
      ruleChain.flatMap((chained) => {
        const module = modules.get(chained.ruleId);
        return module ? [module] : [];
      }),
    ),
    setHistory: [],
    setMemory: {},
  };
}

function cards(ids: readonly string[]): Card[] {
  return ids.map((id) => {
    const card = CARD_BY_ID.get(id);
    if (!card) throw new Error(`Unknown card: ${id}`);
    return card;
  });
}

interface Table {
  config: GameConfig;
  state: GameState;
  runtime: RuleRuntime;
}

function table(
  ruleChain: RuleChainEntry[],
  hands: Record<string, readonly string[]>,
): Table {
  const config: GameConfig = {
    gameIndex: 0,
    seats: [...SEATS],
    gameSeed: 'statuses',
    ruleChain,
  };
  const base = startGame(config).state;
  return {
    config,
    runtime: runtime(ruleChain),
    state: {
      ...base,
      public: {
        ...base.public,
        turn: SEATS[0]!,
        field: { passedSinceLastPlay: [] },
      },
      players: Object.fromEntries(
        SEATS.map((id) => [
          id,
          {
            id,
            hand: cards(hands[id] ?? []),
            status: 'active' as const,
            skipCount: 0,
          },
        ]),
      ),
    },
  };
}

function play(table: Table, player: string, ids: readonly string[]): Table {
  expect(table.state.public.turn).toBe(player);
  const transition = reduceGame(
    table.config,
    table.state,
    { type: 'play', player, cards: [...ids] },
    table.runtime,
  );
  expect(transition.rejections).toEqual([]);
  return { ...table, state: transition.state };
}

/** 場が流れるまでパスを重ねる。場が流れると nextLeader に手番が渡る。 */
function passUntilFieldCleared(table: Table): Table {
  let current = table;
  for (let guard = 0; guard < 4; guard += 1) {
    if (current.state.public.field.current === undefined) return current;
    const player = current.state.public.turn!;
    const transition = reduceGame(
      current.config,
      current.state,
      { type: 'pass', player },
      current.runtime,
    );
    expect(transition.rejections).toEqual([]);
    current = { ...current, state: transition.state };
  }
  throw new Error('Field was not cleared');
}

function statuses(table: Table) {
  return gameStatusViews(table.state, table.config.ruleChain);
}

function strengthInverted(table: Table): boolean {
  return buildPlayerSnapshot(
    table.config,
    table.state,
    {
      setId: 'set-1',
      setPhase: { name: 'gameInProgress', gameIndex: 0 },
      members: SEATS.map((id) => ({ id, displayName: id, isAI: false })),
      setResults: [],
    },
    SEATS[0]!,
    table.runtime,
  ).strengthNote.inverted;
}

describe('継続状態の導出', () => {
  it('革命は発動すると局スコープで出て、場が流れても残り、革命返しで消える', () => {
    const chain = [REVOLUTION_ENTRY, ELEVEN_BACK_ENTRY, BINDING_ENTRY];
    let current = table(chain, {
      p1: ['S05', 'H05', 'D05', 'C05', 'S07'],
      p2: ['S04', 'H04', 'D04', 'C04', 'H07'],
      p3: ['S09', 'H09', 'D09', 'C09'],
      p4: ['S10', 'H10', 'D10', 'C10'],
    });
    expect(statuses(current)).toEqual([]);

    current = play(current, 'p1', ['S05', 'H05', 'D05', 'C05']);
    expect(statuses(current)).toEqual([
      { ruleId: REVOLUTION, name: '革命', scope: 'game' },
    ]);
    expect(strengthInverted(current)).toBe(true);

    const cleared = passUntilFieldCleared(current);
    expect(statuses(cleared)).toEqual([
      { ruleId: REVOLUTION, name: '革命', scope: 'game' },
    ]);

    /*
     * 革命中は 4 が 5 より強い。革命返しで革命が降りる。
     * 4枚組が2手続くのでスート構成は一致し、縛りの側は立つ。
     */
    const back = play(current, 'p2', ['S04', 'H04', 'D04', 'C04']);
    expect(statuses(back)).toEqual([
      {
        ruleId: BINDING,
        name: 'しばり',
        scope: 'field',
        suits: ['spade', 'heart', 'diamond', 'club'],
      },
    ]);
    expect(strengthInverted(back)).toBe(false);
  });

  it('イレブンバックは場スコープで出て、場が流れると消える', () => {
    const chain = [REVOLUTION_ENTRY, ELEVEN_BACK_ENTRY, BINDING_ENTRY];
    let current = table(chain, {
      p1: ['SJ', 'S05'],
      p2: ['H05', 'H07'],
      p3: ['D05', 'D07'],
      p4: ['C05', 'C07'],
    });

    current = play(current, 'p1', ['SJ']);
    expect(statuses(current)).toEqual([
      { ruleId: ELEVEN_BACK, name: 'イレブンバック', scope: 'field' },
    ]);
    expect(strengthInverted(current)).toBe(true);

    const cleared = passUntilFieldCleared(current);
    expect(statuses(cleared)).toEqual([]);
    expect(strengthInverted(cleared)).toBe(false);
  });

  it('同じスート構成が2手続くと縛りが出て、場が流れると消える', () => {
    const chain = [REVOLUTION_ENTRY, ELEVEN_BACK_ENTRY, BINDING_ENTRY];
    let current = table(chain, {
      p1: ['S05', 'S09'],
      p2: ['S07', 'H09'],
      p3: ['D08', 'D09'],
      p4: ['C08', 'C09'],
    });

    current = play(current, 'p1', ['S05']);
    expect(statuses(current)).toEqual([]);

    current = play(current, 'p2', ['S07']);
    expect(statuses(current)).toEqual([
      { ruleId: BINDING, name: 'しばり', scope: 'field', suits: ['spade'] },
    ]);

    const cleared = passUntilFieldCleared(current);
    expect(statuses(cleared)).toEqual([]);
  });

  it('ダブル縛りはスート構成をそのまま載せる', () => {
    const chain = [REVOLUTION_ENTRY, ELEVEN_BACK_ENTRY, BINDING_ENTRY];
    let current = table(chain, {
      p1: ['S05', 'H05'],
      p2: ['S07', 'H07'],
      p3: ['D08', 'C08'],
      p4: ['D09', 'C09'],
    });

    current = play(current, 'p1', ['S05', 'H05']);
    current = play(current, 'p2', ['S07', 'H07']);
    expect(statuses(current)).toEqual([
      {
        ruleId: BINDING,
        name: 'しばり',
        scope: 'field',
        suits: ['spade', 'heart'],
      },
    ]);
  });

  it('JOKERを挟んだ2手は縛りを成立させない', () => {
    const chain = [
      REVOLUTION_ENTRY,
      ELEVEN_BACK_ENTRY,
      BINDING_ENTRY,
      JOKER_ENTRY,
    ];
    let current = table(chain, {
      p1: ['S05', 'H05'],
      p2: ['D07', 'JK0'],
      p3: ['S09', 'H09'],
      p4: ['D10', 'C10'],
    });

    // ♠♥ の組 → JOKER 入りの組 → ♠♥ の組。JOKER が直前手の記憶を切るので縛らない。
    current = play(current, 'p1', ['S05', 'H05']);
    current = play(current, 'p2', ['D07', 'JK0']);
    current = play(current, 'p3', ['S09', 'H09']);
    expect(statuses(current)).toEqual([]);

    // JOKER 入りの手どうしは、自然札のスート構成が揃っても縛りを作らない。
    let jokers = table(chain, {
      p1: ['D05', 'JK0'],
      p2: ['D07', 'JK1'],
      p3: ['S09', 'H09'],
      p4: ['D10', 'C10'],
    });
    jokers = play(jokers, 'p1', ['D05', 'JK0']);
    jokers = play(jokers, 'p2', ['D07', 'JK1']);
    expect(statuses(jokers)).toEqual([]);
  });

  it('縛りの導出はr0008の実際の合法手制限と一致する', () => {
    const chain = [REVOLUTION_ENTRY, ELEVEN_BACK_ENTRY, BINDING_ENTRY];
    let current = table(chain, {
      p1: ['S05', 'S09'],
      p2: ['S07', 'H09'],
      p3: ['S08', 'H08', 'D08', 'C08'],
      p4: ['D09', 'C09'],
    });

    current = play(current, 'p1', ['S05']);
    const beforeBinding = enumerateLegalPlays(
      current.config,
      current.state,
      'p2',
      current.runtime,
    );
    expect(beforeBinding.some((option) => option.cards[0]?.id === 'H09')).toBe(
      true,
    );

    current = play(current, 'p2', ['S07']);
    expect(statuses(current)).toEqual([
      { ruleId: BINDING, name: 'しばり', scope: 'field', suits: ['spade'] },
    ]);

    const legal = enumerateLegalPlays(
      current.config,
      current.state,
      'p3',
      current.runtime,
    );
    expect(legal.length).toBeGreaterThan(0);
    for (const option of legal) {
      for (const card of option.cards) {
        expect(card.kind === 'natural' && card.suit).toBe('spade');
      }
    }
  });

  it('革命とイレブンバックが重なると状態は2件、正味の反転は消える', () => {
    const chain = [REVOLUTION_ENTRY, ELEVEN_BACK_ENTRY, BINDING_ENTRY];
    let current = table(chain, {
      p1: ['S05', 'H05', 'D05', 'C05', 'SJ'],
      p2: ['S04', 'H04', 'H07'],
      p3: ['D08', 'D07'],
      p4: ['C08', 'C07'],
    });

    current = play(current, 'p1', ['S05', 'H05', 'D05', 'C05']);
    current = passUntilFieldCleared(current);
    expect(current.state.public.turn).toBe('p1');
    current = play(current, 'p1', ['SJ']);

    expect(statuses(current)).toEqual([
      { ruleId: REVOLUTION, name: '革命', scope: 'game' },
      { ruleId: ELEVEN_BACK, name: 'イレブンバック', scope: 'field' },
    ]);
    expect(strengthInverted(current)).toBe(false);
  });

  it('部屋で有効でないルールの状態は出さない', () => {
    const chain = [ELEVEN_BACK_ENTRY, BINDING_ENTRY];
    let current = table(chain, {
      p1: ['S05', 'H05', 'D05', 'C05'],
      p2: ['S07', 'H07', 'D07', 'C07'],
      p3: ['S09', 'H09', 'D09', 'C09'],
      p4: ['S10', 'H10', 'D10', 'C10'],
    });
    current = play(current, 'p1', ['S05', 'H05', 'D05', 'C05']);
    expect(statuses(current)).toEqual([]);
  });
});

function playingRoom(ruleChain: RuleChainEntry[]): RoomState {
  let state = createRoomState({
    roomId: 'room-statuses',
    inviteCode: '01234',
    mode: 'community',
    owner: {
      memberId: 'member-1',
      userId: 'private-user-1',
      displayName: 'ホスト',
    },
    now: 100,
  });
  for (let index = 2; index <= 4; index += 1) {
    const joined = reduceRoom(state, {
      type: 'join',
      member: {
        memberId: `member-${index}`,
        userId: `private-user-${index}`,
        displayName: `プレイヤー${index}`,
      },
      now: 100 + index,
    });
    expect(joined.accepted).toBe(true);
    state = joined.state;
  }
  const started = reduceRoom(
    state,
    {
      type: 'start',
      memberId: 'member-1',
      now: 1_000,
      setSeed: 'statuses-set',
      availableRules: ruleChain,
    },
    { random: () => 0.999_999 },
  );
  expect(started.accepted).toBe(true);
  return started.state;
}

describe('継続状態の配信', () => {
  it('対局中のviewへ載せ、再取得しても同じ内容になる', () => {
    const chain = [REVOLUTION_ENTRY, ELEVEN_BACK_ENTRY, BINDING_ENTRY];
    const room = playingRoom(chain);
    const engine = room.engine!;
    expect(engine.ruleChain.map((chained) => chained.ruleId)).toEqual([
      REVOLUTION,
      ELEVEN_BACK,
      BINDING,
    ]);

    const members = engine.members.map((member) => member.id);
    const config: GameConfig = {
      gameIndex: 0,
      seats: members,
      gameSeed: `${engine.setSeed}:0`,
      ruleChain: engine.ruleChain,
    };
    const port = runtime(engine.ruleChain).port;
    let staged: Table = {
      config,
      runtime: runtime(engine.ruleChain),
      state: {
        ...engine.currentGame!,
        public: {
          ...engine.currentGame!.public,
          turn: members[0]!,
          field: { passedSinceLastPlay: [] },
          history: [],
        },
        players: Object.fromEntries(
          members.map((id, index) => [
            id,
            {
              id,
              hand: cards(
                [
                  ['S05', 'H05', 'D05', 'C05', 'SJ'],
                  ['S04', 'H04', 'H07'],
                  ['D08', 'D07'],
                  ['C08', 'C07'],
                ][index]!,
              ),
              status: 'active' as const,
              skipCount: 0,
            },
          ]),
        ),
      },
    };
    staged = play(staged, members[0]!, ['S05', 'H05', 'D05', 'C05']);

    const withGame: RoomState = {
      ...room,
      engine: { ...engine, currentGame: staged.state },
    };
    const view = viewFor(withGame, 'member-1', { rulePort: port });
    expect(view.game?.statuses).toEqual([
      { ruleId: REVOLUTION, name: '革命', scope: 'game' },
    ]);
    expect(view.game?.strengthInverted).toBe(true);

    const reconnected = viewFor(withGame, 'member-1', {
      reconnect: true,
      rulePort: port,
    });
    expect(reconnected.game?.statuses).toEqual(view.game?.statuses);
    expect(reconnected.game?.strengthInverted).toBe(
      view.game?.strengthInverted,
    );
  });
});
