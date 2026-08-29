import type { DeepReadonly, Play, RuleModule } from '@daifugo/core';
import { suitBindingFromHistory } from '@daifugo/core';

const RELEASED_MEMORY_KEY = 'released';

function samePlay(
  left: DeepReadonly<Play>,
  right: DeepReadonly<Play>,
): boolean {
  if (left.kind !== right.kind || left.cards.length !== right.cards.length) {
    return false;
  }
  const leftIds = left.cards.map((card) => card.id).toSorted();
  const rightIds = right.cards.map((card) => card.id).toSorted();
  return leftIds.every((id, index) => id === rightIds[index]);
}

function historyBeforeCurrentPlay(
  context: Parameters<NonNullable<RuleModule['hooks']['afterPlay']>>[0],
  play: DeepReadonly<Play>,
) {
  const currentIndex = context.game.history.findLastIndex(
    (event) => event.type === 'played' && samePlay(event.play, play),
  );
  return currentIndex < 0
    ? context.game.history
    : context.game.history.slice(0, currentIndex);
}

function containsNaturalQueen(play: DeepReadonly<Play>): boolean {
  return play.cards.some(
    (card) => card.kind === 'natural' && card.rank === 'Q',
  );
}

export const rule: RuleModule = {
  meta: {
    ruleId: 'r0038-q-toki',
    name: 'Q解き',
    description:
      'しばり中にQを含む合法な手を出すと、その手の解決後に現在のしばりを解除する。Qを出す手自体には解除前のしばりを適用する。',
    kind: 'local',
    proposalId: '01M07AB117T52NWAT1RX9X4AHX',
    contractVersion: 1,
    messages: {},
  },
  hooks: {
    modifyLegality(_context, _play, base) {
      return base;
    },
    afterPlay(context, play) {
      if (!containsNaturalQueen(play)) return [];
      const binding = suitBindingFromHistory(
        historyBeforeCurrentPlay(context, play),
        context.game.suitBindingResetAfter,
      );
      if (binding === null) return [];

      return [
        { type: 'clearSuitBinding' },
        {
          type: 'setMemory',
          scope: 'game',
          key: RELEASED_MEMORY_KEY,
          value: true,
          silent: true,
        },
      ];
    },
    afterFieldClear(context) {
      if (context.memory.game[RELEASED_MEMORY_KEY] !== true) return [];
      return [
        {
          type: 'setMemory',
          scope: 'game',
          key: RELEASED_MEMORY_KEY,
          value: false,
          silent: true,
        },
      ];
    },
  },
};
