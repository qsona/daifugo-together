import type {
  DeepReadonly,
  JsonValue,
  PublicGameEvent,
  RuleModule,
  StrengthOrder,
} from '@daifugo/core';

const WINDOW_KEY = 'activeWindow';
const ELEVEN_BACK_RULE_ID = 'r0005-eleven-back';
const SIX_RETURN_RULE_ID = 'r0019-6-modoshi';

interface ActiveWindow {
  startedAfterTurn: number;
  duration: number;
}

function completedTurns(
  history: readonly DeepReadonly<PublicGameEvent>[],
): number {
  return history.filter(
    (event) => event.type === 'played' || event.type === 'passed',
  ).length;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function activeWindow(
  value: DeepReadonly<JsonValue> | undefined,
): ActiveWindow | null {
  if (!isRecord(value)) return null;
  const startedAfterTurn = value.startedAfterTurn;
  const duration = value.duration;
  return Number.isSafeInteger(startedAfterTurn) &&
    typeof startedAfterTurn === 'number' &&
    startedAfterTurn >= 0 &&
    Number.isSafeInteger(duration) &&
    typeof duration === 'number' &&
    duration >= 2
    ? { startedAfterTurn, duration }
    : null;
}

function containsNaturalRank(
  event: DeepReadonly<PublicGameEvent>,
  rank: '6',
): boolean {
  return (
    event.type === 'played' &&
    event.play.cards.some(
      (card) => card.kind === 'natural' && card.rank === rank,
    )
  );
}

function ordinaryElevenBackIsReversed(
  history: readonly DeepReadonly<PublicGameEvent>[],
  ruleIds: readonly string[],
): boolean {
  if (!ruleIds.includes(ELEVEN_BACK_RULE_ID)) return false;

  const sixReturnEnabled = ruleIds.includes(SIX_RETURN_RULE_ID);
  let active = false;
  let cancelled = false;

  for (const event of history) {
    if (event.type === 'fieldCleared') {
      active = false;
      cancelled = false;
      continue;
    }
    if (event.type === 'ruleFired' && event.ruleId === ELEVEN_BACK_RULE_ID) {
      active = true;
      cancelled = false;
      continue;
    }
    if (sixReturnEnabled && active && containsNaturalRank(event, '6')) {
      cancelled = true;
    }
  }

  return active && !cancelled;
}

function reverseRanking(
  base: DeepReadonly<StrengthOrder>,
): DeepReadonly<StrengthOrder> {
  return { ...base, ranking: [...base.ranking].reverse() };
}

export const rule: RuleModule = {
  meta: {
    ruleId: 'r0039-enhanced-j-back',
    name: '強化Jバック',
    description:
      '自然なランクJが1枚だけの手は本ルールの強化効果を発動せず既存のイレブンバックに委ねる。自然なランクJをn枚（nは2以上）含む合法な手を出すと、その手の解決後から次のn手番が完了するまで、永続的な革命状態を変えずにジョーカー以外の強さ順を一時的に1回だけ反転する。',
    kind: 'local',
    proposalId: '01M07Q18AVEM959XZ3DBFH7VYG',
    contractVersion: 1,
    messages: {},
  },
  hooks: {
    modifyStrength(context, base) {
      const window = activeWindow(context.memory.game[WINDOW_KEY]);
      if (window === null) return base;

      const elapsed =
        completedTurns(context.game.history) - window.startedAfterTurn;
      const enhancedIsReversed = elapsed >= 0 && elapsed < window.duration;
      const ordinaryIsReversed = ordinaryElevenBackIsReversed(
        context.game.history,
        context.game.ruleIds,
      );

      return enhancedIsReversed === ordinaryIsReversed
        ? base
        : reverseRanking(base);
    },
    afterPlay(context, play) {
      const duration = play.cards.filter(
        (card) => card.kind === 'natural' && card.rank === 'J',
      ).length;

      if (duration >= 2) {
        return [
          {
            type: 'setMemory',
            scope: 'game',
            key: WINDOW_KEY,
            value: {
              startedAfterTurn: completedTurns(context.game.history),
              duration,
            },
          },
        ];
      }

      if (
        duration === 1 &&
        activeWindow(context.memory.game[WINDOW_KEY]) !== null
      ) {
        return [
          {
            type: 'setMemory',
            scope: 'game',
            key: WINDOW_KEY,
            value: null,
            silent: true,
          },
        ];
      }

      return [];
    },
  },
};
