import type { DeepReadonly, Play, RuleModule } from '@daifugo/core';

const SUITS = ['spade', 'heart', 'diamond', 'club'] as const;

type SuitCounts = [number, number, number, number];

function naturalSuitCounts(play: DeepReadonly<Play>): SuitCounts {
  const counts: SuitCounts = [0, 0, 0, 0];
  for (const card of play.cards) {
    if (card.kind === 'natural') {
      const index = SUITS.indexOf(card.suit);
      counts[index] = (counts[index] ?? 0) + 1;
    }
  }
  return counts;
}

function signature(counts: SuitCounts): string {
  return counts.join(',');
}

function containsJoker(play: DeepReadonly<Play>): boolean {
  return play.cards.some((card) => card.kind === 'joker');
}

function bindingFromHistory(
  context: Parameters<NonNullable<RuleModule['hooks']['modifyLegality']>>[0],
): string | null {
  return bindingFromEvents(context.game.history);
}

function bindingFromEvents(
  history: Parameters<
    NonNullable<RuleModule['hooks']['modifyLegality']>
  >[0]['game']['history'],
): string | null {
  let previous: string | null = null;
  let binding: string | null = null;

  for (const event of history) {
    if (event.type === 'fieldCleared') {
      previous = null;
      binding = null;
      continue;
    }
    if (event.type !== 'played') continue;
    if (containsJoker(event.play)) {
      previous = null;
      continue;
    }

    const current = signature(naturalSuitCounts(event.play));
    if (binding === null && previous === current) {
      binding = current;
    }
    previous = current;
  }

  return binding;
}

function previousPlayOnField(
  history: Parameters<
    NonNullable<RuleModule['hooks']['afterPlay']>
  >[0]['game']['history'],
): DeepReadonly<Play> | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const event = history[index];
    if (event?.type === 'fieldCleared') return null;
    if (event?.type === 'played') return event.play;
  }
  return null;
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

function chooseMissingSuits(
  counts: SuitCounts,
  remaining: number,
  start: number,
  result: string[],
): void {
  if (remaining === 0) {
    result.push(signature(counts));
    return;
  }
  for (let index = start; index < SUITS.length; index += 1) {
    if ((counts[index] ?? 0) !== 0) continue;
    const next = [...counts] as SuitCounts;
    next[index] = 1;
    chooseMissingSuits(next, remaining - 1, index + 1, result);
  }
}

function suitOptions(play: DeepReadonly<Play>): string[] {
  const counts = naturalSuitCounts(play);
  const jokerCount = play.cards.filter((card) => card.kind === 'joker').length;
  if (jokerCount === 0) return [signature(counts)];

  if (play.kind === 'sequence') {
    const naturalSuitIndexes = counts
      .map((count, index) => (count > 0 ? index : -1))
      .filter((index) => index >= 0);
    if (naturalSuitIndexes.length > 1) return [];
    if (naturalSuitIndexes.length === 1) {
      const index = naturalSuitIndexes[0]!;
      counts[index] = (counts[index] ?? 0) + jokerCount;
      return [signature(counts)];
    }
    return SUITS.map((_, index) => {
      const option: SuitCounts = [0, 0, 0, 0];
      option[index] = jokerCount;
      return signature(option);
    });
  }

  const options: string[] = [];
  chooseMissingSuits(counts, jokerCount, 0, options);
  return options;
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
      const binding = bindingFromHistory(context);
      if (binding === null) return base;
      return suitOptions(play).includes(binding) ? base : { legal: false };
    },
    afterPlay(context, play) {
      const priorHistory = historyBeforeCurrentPlay(context, play);
      if (bindingFromEvents(priorHistory) !== null || containsJoker(play))
        return [];
      const previous = previousPlayOnField(priorHistory);
      if (
        previous === null ||
        containsJoker(previous) ||
        signature(naturalSuitCounts(previous)) !==
          signature(naturalSuitCounts(play))
      ) {
        return [];
      }
      return [{ type: 'announce', messageKey: 'bindingActivated' }];
    },
  },
};
