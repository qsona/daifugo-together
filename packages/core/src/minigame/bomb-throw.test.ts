import { describe, expect, it } from 'vitest';

import {
  advanceBombThrowMiniGame,
  applyBombThrowCommand,
  BOMB_THROW_COUNTDOWN_MS,
  bombThrowComplete,
  bombThrowResult,
  createBombThrowMiniGame,
} from './bomb-throw.js';

describe('ボムスロー15', () => {
  it('1秒のカットインと3カウント、12秒の対戦、1秒の結果表示で完了する', () => {
    let state = createBombThrowMiniGame({
      id: 'test',
      seed: 'seed',
      participants: ['p1', 'p2'],
    });
    for (let index = 0; index < 19; index += 1) {
      state = advanceBombThrowMiniGame(state);
    }
    expect(state.phase).toBe('countdown');
    state = advanceBombThrowMiniGame(state);
    expect(state.phase).toBe('playing');

    while (state.elapsedMs < BOMB_THROW_COUNTDOWN_MS + 12_000) {
      state = advanceBombThrowMiniGame(state, {
        automatedPlayerIds: ['p1', 'p2'],
      });
    }
    expect(state.phase).toBe('result');
    expect(bombThrowComplete(state)).toBe(false);

    while (!bombThrowComplete(state)) {
      state = advanceBombThrowMiniGame(state);
    }
    expect(state.elapsedMs).toBe(17_000);
    expect(bombThrowResult(state).winnerPlayerId).toBeTruthy();
  });

  it('カットインと説明中の先行入力を対戦開始へ持ち越さない', () => {
    const state = createBombThrowMiniGame({
      id: 'countdown-input',
      seed: 'seed',
      participants: ['p1', 'p2'],
    });
    const commanded = applyBombThrowCommand(state, {
      playerId: 'p1',
      direction: 'down',
      throwBomb: true,
    });

    expect(commanded).toBe(state);
    expect(commanded.players.p1?.throwQueued).toBe(false);
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
      elapsedMs: BOMB_THROW_COUNTDOWN_MS,
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
