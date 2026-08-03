import { describe, expect, it } from 'vitest';

import {
  advanceBombThrowMiniGame,
  applyBombThrowCommand,
  bombThrowComplete,
  bombThrowResult,
  createBombThrowMiniGame,
} from './bomb-throw.js';

describe('ボムスロー15', () => {
  it('2秒の開始演出、12秒の対戦、1秒の結果表示で完了する', () => {
    let state = createBombThrowMiniGame({
      id: 'test',
      seed: 'seed',
      participants: ['p1', 'p2'],
    });
    for (let index = 0; index < 9; index += 1) {
      state = advanceBombThrowMiniGame(state);
    }
    expect(state.phase).toBe('countdown');
    state = advanceBombThrowMiniGame(state);
    expect(state.phase).toBe('playing');

    while (state.elapsedMs < 14_000) {
      state = advanceBombThrowMiniGame(state, {
        automatedPlayerIds: ['p1', 'p2'],
      });
    }
    expect(state.phase).toBe('result');
    expect(bombThrowComplete(state)).toBe(false);

    while (!bombThrowComplete(state)) {
      state = advanceBombThrowMiniGame(state);
    }
    expect(state.elapsedMs).toBe(15_000);
    expect(bombThrowResult(state).winnerPlayerId).toBeTruthy();
  });

  it('投げた爆弾の爆風が相手に当たると投げ手だけが得点する', () => {
    let state = createBombThrowMiniGame({
      id: 'hit-test',
      seed: 'seed',
      participants: ['p1', 'p2'],
    });
    state = {
      ...state,
      phase: 'playing',
      elapsedMs: 2_000,
      players: {
        ...state.players,
        p1: { ...state.players.p1!, x: 0, y: 0, direction: 'right' },
        p2: { ...state.players.p2!, x: 4, y: 0, direction: 'stop' },
      },
    };
    state = applyBombThrowCommand(state, {
      playerId: 'p1',
      direction: 'right',
      throwBomb: true,
    });
    for (let index = 0; index < 6; index += 1) {
      state = advanceBombThrowMiniGame(state);
    }
    expect(state.players.p1?.score).toBe(1);
    expect(state.players.p1?.hitsTaken).toBe(0);
    expect(state.players.p2?.hitsTaken).toBe(1);
  });

  it('同じseedと入力ならAI戦を含めて同じ勝敗になる', () => {
    const run = () => {
      let state = createBombThrowMiniGame({
        id: 'deterministic',
        seed: 'same-seed',
        participants: ['p1', 'p2', 'p3', 'p4'],
      });
      while (!bombThrowComplete(state)) {
        state = advanceBombThrowMiniGame(state, {
          automatedPlayerIds: ['p1', 'p2', 'p3', 'p4'],
        });
      }
      return bombThrowResult(state);
    };
    expect(run()).toEqual(run());
  });
});
