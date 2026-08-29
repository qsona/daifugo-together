import type { DeepReadonly, Play, RuleModule } from '@daifugo/core';
import {
  hasSameNaturalSuitSignature,
  playMatchesSuitBinding,
  previousPlayForSuitBinding,
  suitBindingFromHistory,
} from '@daifugo/core';

function containsJoker(play: DeepReadonly<Play>): boolean {
  return play.cards.some((card) => card.kind === 'joker');
}

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

/**
 * contract v2 の追加入力後は、最初の play イベントが履歴へ確定した状態で
 * afterPlay が再開される。通常の afterPlay と同じ「今回の手より前」の履歴へ
 * 揃えないと、今回の手を自分自身の直前手として縛りを誤検出する。
 */
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

export const rule: RuleModule = {
  meta: {
    ruleId: 'r0008-shibari-double-shibari',
    name: 'しばり',
    description:
      '同じ場で連続して出されたJOKERを含まない手のスート構成が完全に一致した場合、場が流れるまで、そのスート構成と完全に一致する手だけを合法とする。JOKERを含む手は不足するスートを代用して既存の縛りを満たせるが、新しい縛りの成立判定には使わない。場が流れると縛りを解除する。',
    kind: 'local',
    proposalId: '01KYQNNS40BN7CXGYDHZQCKQD3',
    contractVersion: 1,
    messages: {},
  },
  hooks: {
    modifyLegality(context, play, base) {
      const binding = suitBindingFromHistory(
        context.game.history,
        context.game.suitBindingResetAfter,
      );
      if (binding === null) return base;
      return playMatchesSuitBinding(play, binding) ? base : { legal: false };
    },
    afterPlay(context, play) {
      const priorHistory = historyBeforeCurrentPlay(context, play);
      if (
        suitBindingFromHistory(
          priorHistory,
          context.game.suitBindingResetAfter,
        ) !== null ||
        containsJoker(play)
      ) {
        return [];
      }
      const previous = previousPlayForSuitBinding(
        priorHistory,
        context.game.suitBindingResetAfter,
      );
      if (
        previous === null ||
        containsJoker(previous) ||
        !hasSameNaturalSuitSignature(previous, play)
      ) {
        return [];
      }
      return [{ type: 'announce', messageKey: 'bindingActivated' }];
    },
  },
};
