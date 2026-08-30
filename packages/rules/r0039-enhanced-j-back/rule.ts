import type {
  DeepReadonly,
  JsonValue,
  PublicGameEvent,
  RuleModule,
  StrengthOrder,
} from '@daifugo/core';

const WINDOW_KEY = 'activeWindow';

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
    duration > 0
    ? { startedAfterTurn, duration }
    : null;
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
      '自然なランクJをn枚含む合法な手を出すと、その手の解決後から次のn手番が完了するまで、永続的な革命状態を変えずにジョーカー以外の強さ順を一時的に反転する。',
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
      return elapsed >= 0 && elapsed < window.duration
        ? reverseRanking(base)
        : base;
    },
    afterPlay(context, play) {
      const duration = play.cards.filter(
        (card) => card.kind === 'natural' && card.rank === 'J',
      ).length;
      return duration === 0
        ? []
        : [
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
    },
  },
};
