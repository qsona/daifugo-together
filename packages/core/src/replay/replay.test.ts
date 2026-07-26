import { describe, expect, it } from 'vitest';

import { enumerateLegalPlays } from '../play/candidates.js';
import { noRuleRuntime } from '../rules/chain.js';
import { reduceSet, startSet, type StartSetInput } from '../set/set-reducer.js';
import type { ReplayRecord, SetAction } from '../set/types.js';
import {
  appendAcceptedReplayAction,
  createReplayAction,
  createReplayInit,
  replaySet,
} from './replay.js';

const input: StartSetInput = {
  setId: 'replay-set',
  config: { gamesPerSet: 1, interimAutoAdvanceMs: 0 },
  members: ['p1', 'p2', 'p3', 'p4'].map((id) => ({
    id,
    displayName: id,
    isAI: true,
  })),
  ruleChain: [],
  setSeed: 'replay-seed',
};

describe('GE-05 replay execution and append boundary', () => {
  it('受理済みアクション列からセット最終状態を再現する', () => {
    let state = startSet(input);
    const records = [];
    let seq = 0;
    while (state.phase.name !== 'setResult' && seq < 1000) {
      const game = state.currentGame;
      if (!game || state.phase.name !== 'gameInProgress') {
        throw new Error('Unexpected replay fixture phase');
      }
      const player = game.public.turn;
      if (!player) {
        throw new Error('Missing turn');
      }
      const config = {
        gameIndex: state.phase.gameIndex,
        seats: state.members.map((member) => member.id),
        gameSeed: `${state.setSeed}:${state.phase.gameIndex}`,
        ruleChain: state.ruleChain,
      };
      const legal = enumerateLegalPlays(config, game, player, noRuleRuntime());
      const play = legal[0];
      const action: SetAction = play
        ? {
            type: 'play',
            player,
            cards: play.cards.map((card) => card.id),
          }
        : { type: 'pass', player };
      const transition = reduceSet(state, action);
      expect(transition.rejections).toEqual([]);
      expect(transition.acceptedAction).toEqual(action);
      records.push(createReplayAction(seq, action));
      state = transition.state;
      seq += 1;
    }
    expect(state.phase.name).toBe('setResult');

    const init = createReplayInit(input, '0.0.0');
    const replayed = replaySet(init, records, undefined, {
      engineVersion: '0.0.0',
      contractVersion: 1,
    });
    expect(replayed.warnings).toEqual([]);
    expect(replayed.appliedActions).toBe(records.length);
    expect(replayed.state).toEqual(state);
  });

  it('バージョン不一致は警告して続行し、却下アクションは追記しない', async () => {
    const init = createReplayInit(input, 'old-engine');
    const replayed = replaySet(init, [], undefined, {
      engineVersion: 'new-engine',
      contractVersion: 2,
    });
    expect(replayed.warnings).toEqual([
      'engineVersion mismatch: replay=old-engine, current=new-engine',
      'contractVersion mismatch: replay=1, current=2',
    ]);

    const records: ReplayRecord[] = [];
    const appended = await appendAcceptedReplayAction(
      { append: (record) => void records.push(record) },
      0,
      undefined,
    );
    expect(appended).toBe(false);
    expect(records).toEqual([]);
  });
});
