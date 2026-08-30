import type { RuleContext, RuleModule } from '@daifugo/core';

const CHOICE_ID = 'pass_count';
const TARGET_KEY = 'target';
const COUNT_KEY = 'count';
const TRIGGERED_KEY = 'triggered';
const MIN_COUNT = 4;
const MAX_COUNT = 12;
const DEFAULT_COUNT = 8;

function previousDaihinmin(context: RuleContext): string | undefined {
  return context.setHistory
    .at(-1)
    ?.standings.find(({ standing }) => standing === 4)?.player;
}

function choiceRequest(player: string) {
  return {
    type: 'requestChoice' as const,
    kind: 'integer' as const,
    player,
    choiceId: CHOICE_ID,
    min: MIN_COUNT,
    max: MAX_COUNT,
    defaultValue: DEFAULT_COUNT,
    messageKey: 'choose_count',
  };
}

function storedInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? value
    : null;
}

export const rule: RuleModule = {
  meta: {
    ruleId: 'r0033-guillotine-clock',
    name: 'ギロチン時計',
    description:
      '初回ゲームでは発動しない。2ゲーム目以降の開始時、前ゲームの大貧民が4〜12からNを選ぶ。そのゲームで全員通算N回目の通常パスをしたプレイヤーを直ちに最低順位へ強制する。skipTurnsによる自動スキップは数えない。',
    kind: 'local',
    proposalId: '01M079JQC6AC0JMCXNY9Y1BYZ0',
    contractVersion: 2,
    messages: {
      choose_count: '何回目のパスで大貧民にしますか？',
      count_set: '{count}回目のパスで大貧民！',
      triggered: 'ギロチン時計！ {count}回目のパスで大貧民！',
    },
  },
  hooks: {
    onGameStart(context, input) {
      const player = previousDaihinmin(context);
      if (!player) return [];

      if (
        input?.kind === 'integer' &&
        input.choiceId === CHOICE_ID &&
        Number.isSafeInteger(input.value) &&
        input.value >= MIN_COUNT &&
        input.value <= MAX_COUNT
      ) {
        return [
          {
            type: 'setMemory',
            scope: 'game',
            key: TARGET_KEY,
            value: input.value,
            silent: true,
          },
          {
            type: 'announce',
            messageKey: 'count_set',
            params: { count: String(input.value) },
          },
        ];
      }

      return [choiceRequest(player)];
    },
    afterPass(context, pass) {
      const target = storedInteger(context.memory.game[TARGET_KEY]);
      if (
        target === null ||
        target < MIN_COUNT ||
        target > MAX_COUNT ||
        context.memory.game[TRIGGERED_KEY] === true
      ) {
        return [];
      }

      const storedCount = storedInteger(context.memory.game[COUNT_KEY]);
      const count =
        (storedCount !== null && storedCount >= 0 ? storedCount : 0) + 1;
      const rememberCount = {
        type: 'setMemory' as const,
        scope: 'game' as const,
        key: COUNT_KEY,
        value: count,
        silent: true,
      };
      if (count < target) return [rememberCount];

      return [
        rememberCount,
        {
          type: 'setMemory',
          scope: 'game',
          key: TRIGGERED_KEY,
          value: true,
          silent: true,
        },
        { type: 'forceRank', player: pass.player, rank: 'lowest' },
        {
          type: 'announce',
          messageKey: 'triggered',
          params: { count: String(target) },
        },
      ];
    },
  },
};
