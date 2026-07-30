import { describe, expect, it } from 'vitest';

import { startGame } from '../game/start-game.js';
import type { GameConfig } from '../game/types.js';
import { enumerateLegalPlays } from '../play/candidates.js';
import { createReplayInit, replaySet } from '../replay/replay.js';
import type { StartSetInput } from '../set/set-reducer.js';
import { simulate } from '../sim/simulate.js';
import {
  engineFeaturesOf,
  type Effect,
  type EngineFeature,
  type RuleChainEntry,
  type RuleModule,
} from '../rules/contract.js';
import { createInProcessRuleChainPort } from '../rules/in-process.js';

const seats = ['p1', 'p2', 'p3', 'p4'];

function entry(
  ruleId: string,
  position: number,
  engineFeatures?: EngineFeature[],
): RuleChainEntry {
  return {
    ruleId,
    name: ruleId,
    position,
    priority: { score: 0, activatedAt: 0, ruleId },
    bundleHash: 'fixture',
    contractVersion: 1,
    ...(engineFeatures === undefined ? {} : { engineFeatures }),
  };
}

/** プロトタイプ: 階段ルール (engineFeatures のみ、hooks なし)。 */
const sequenceRule: RuleModule = {
  meta: {
    ruleId: 'r-proto-sequence',
    name: '階段',
    description: '同スート連続3枚以上を出せる',
    kind: 'local',
    proposalId: 'prototype',
    contractVersion: 1,
    messages: {},
    engineFeatures: ['sequence'],
  },
  hooks: {},
};

/** プロトタイプ: ジョーカールール (ジョーカー含みあがりは最低順位)。 */
const jokerRule: RuleModule = {
  meta: {
    ruleId: 'r-proto-jokers',
    name: 'ジョーカー',
    description: 'ジョーカー2枚。最後の手にジョーカーを含めて上がると最低順位',
    kind: 'local',
    proposalId: 'prototype',
    contractVersion: 1,
    messages: {},
    engineFeatures: ['jokers'],
  },
  hooks: {
    afterPlay(context, play) {
      if (!play.cards.some((card) => card.kind === 'joker')) {
        return [];
      }
      const player = context.game.field.current?.by;
      const remaining = context.game.players.find(
        (candidate) => candidate.id === player,
      )?.hand.length;
      if (player === undefined || remaining !== 0) {
        return [];
      }
      const effects: Effect[] = [{ type: 'forceRank', player, rank: 'lowest' }];
      return effects;
    },
  },
};

describe('engineFeatures declaration', () => {
  it('チェーン全体の和集合を宣言順で返し、未宣言エントリは [] になる', () => {
    expect(engineFeaturesOf([entry('a', 0)])).toEqual([]);
    expect(engineFeaturesOf([entry('a', 0, ['jokers'])])).toEqual(['jokers']);
    expect(
      engineFeaturesOf([
        entry('a', 0, ['jokers']),
        entry('b', 1, ['sequence', 'jokers']),
        entry('c', 2),
      ]),
    ).toEqual(['sequence', 'jokers']);
  });
});

describe('jokers deck and dealing', () => {
  it('jokers 有効時は 54 枚を 14/14/13/13 で配り、全カードが一意', () => {
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'joker-deal',
      ruleChain: [entry(jokerRule.meta.ruleId, 0, ['jokers'])],
    };
    const { state } = startGame(config);
    const hands = seats.flatMap((seat) => state.players[seat]?.hand ?? []);
    expect(hands).toHaveLength(54);
    expect(new Set(hands.map((card) => card.id)).size).toBe(54);
    expect(
      seats
        .map((seat) => state.players[seat]?.hand.length ?? 0)
        .sort((left, right) => right - left),
    ).toEqual([14, 14, 13, 13]);
    expect(hands.filter((card) => card.kind === 'joker')).toHaveLength(2);
  });

  it('engineFeatures 未宣言のチェーンでは従来どおり 52 枚', () => {
    const config: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: 'plain-deal',
      ruleChain: [entry('r-plain', 0)],
    };
    const { state } = startGame(config);
    const hands = seats.flatMap((seat) => state.players[seat]?.hand ?? []);
    expect(hands).toHaveLength(52);
    expect(hands.every((card) => card.kind === 'natural')).toBe(true);
  });
});

describe('prototype rules run end to end (in-process runtime)', () => {
  it('階段ルール: セットが最後まで進行し、不変条件違反がない', () => {
    const report = simulate({
      games: 2,
      seed: 'proto-sequence',
      ruleChain: [entry(sequenceRule.meta.ruleId, 0, ['sequence'])],
      port: createInProcessRuleChainPort([sequenceRule]),
    });
    expect(report.completed).toBe(2);
    expect(report.invariantViolations).toEqual([]);
  });

  it('ジョーカールール: 54枚のゾーン全域性を保ったままセットが完走する', () => {
    const report = simulate({
      games: 2,
      seed: 'proto-jokers',
      ruleChain: [entry(jokerRule.meta.ruleId, 0, ['jokers'])],
      port: createInProcessRuleChainPort([jokerRule]),
    });
    expect(report.completed).toBe(2);
    // card-conservation 不変条件が各アクション後に 54 枚のゾーン全域性を検証する
    expect(report.invariantViolations).toEqual([]);
  });

  it('階段+ジョーカー併用でも完走する', () => {
    const report = simulate({
      games: 2,
      seed: 'proto-both',
      ruleChain: [
        entry(sequenceRule.meta.ruleId, 0, ['sequence']),
        entry(jokerRule.meta.ruleId, 1, ['jokers']),
      ],
      port: createInProcessRuleChainPort([sequenceRule, jokerRule]),
    });
    expect(report.completed).toBe(2);
    expect(report.invariantViolations).toEqual([]);
  });
});

describe('replay backward compatibility', () => {
  it('engineFeatures なしの旧リプレイは 52 枚・従来生成器で従来挙動のまま', () => {
    const input: StartSetInput = {
      setId: 'replay-compat',
      config: { gamesPerSet: 3, interimAutoAdvanceMs: 0 },
      members: seats.map((id) => ({ id, displayName: id, isAI: true })),
      ruleChain: [entry('r-legacy', 0)],
      setSeed: 'legacy-seed',
    };
    const init = createReplayInit(input, 'test-engine');
    const replayed = replaySet(init, []);
    const game = replayed.state.currentGame;
    expect(game).not.toBeNull();
    const cards = seats.flatMap((seat) => game?.players[seat]?.hand ?? []);
    expect(cards).toHaveLength(52);
    expect(cards.every((card) => card.kind === 'natural')).toBe(true);

    // 従来生成器のみ: sequence 候補は出ない
    const gameConfig: GameConfig = {
      gameIndex: 0,
      seats,
      gameSeed: `${input.setSeed}:0`,
      ruleChain: input.ruleChain,
    };
    const turn = game?.public.turn;
    expect(turn).toBeTruthy();
    const legal =
      game && turn ? enumerateLegalPlays(gameConfig, game, turn) : [];
    expect(legal.length).toBeGreaterThan(0);
    expect(legal.every((play) => play.kind !== 'sequence')).toBe(true);
  });
});
