import type {
  Card,
  CardId,
  DeepReadonly,
  PlayerId,
  RuleContext,
  RuleModule,
} from '@daifugo/core';

const INCIDENT_KEY = 'incident';
const REQUIRED_FIELD_CLEARS = 3;

interface ActiveIncident {
  active: true;
  champion: PlayerId;
  targets: [PlayerId, PlayerId];
  cardIds: CardId[];
  clears: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function activeIncident(context: RuleContext): ActiveIncident | null {
  const value = context.memory.game[INCIDENT_KEY];
  if (
    !isRecord(value) ||
    value.active !== true ||
    typeof value.champion !== 'string' ||
    !isStringArray(value.targets) ||
    value.targets.length !== 2 ||
    value.targets[0] === value.targets[1] ||
    !isStringArray(value.cardIds) ||
    value.cardIds.length === 0 ||
    typeof value.clears !== 'number' ||
    !Number.isInteger(value.clears) ||
    value.clears < 0
  ) {
    return null;
  }
  const firstTarget = value.targets[0];
  const secondTarget = value.targets[1];
  if (!firstTarget || !secondTarget) return null;

  return {
    active: true,
    champion: value.champion,
    targets: [firstTarget, secondTarget],
    cardIds: [...value.cardIds],
    clears: value.clears,
  };
}

function isProtectedCard(card: DeepReadonly<Card>): boolean {
  return card.kind === 'joker' || card.rank === '2';
}

function targetsStillHoldAll(
  context: RuleContext,
  incident: ActiveIncident,
): boolean {
  const held = new Set(
    context.game.players
      .filter(({ id }) => incident.targets.includes(id))
      .flatMap(({ hand }) => hand.map(({ id }) => id)),
  );
  return incident.cardIds.every((cardId) => held.has(cardId));
}

function storeIncident(incident: ActiveIncident) {
  return {
    type: 'setMemory' as const,
    scope: 'game' as const,
    key: INCIDENT_KEY,
    value: {
      active: incident.active,
      champion: incident.champion,
      targets: [...incident.targets],
      cardIds: [...incident.cardIds],
      clears: incident.clears,
    },
    silent: true,
  };
}

function closeIncident(
  incident: ActiveIncident,
  outcome: 'failed' | 'succeeded',
) {
  return {
    type: 'setMemory' as const,
    scope: 'game' as const,
    key: INCIDENT_KEY,
    value: {
      active: false,
      champion: incident.champion,
      targets: [...incident.targets],
      cardIds: [...incident.cardIds],
      clears: incident.clears,
      outcome,
    },
    silent: true,
  };
}

function failIncident(incident: ActiveIncident) {
  return [
    closeIncident(incident, 'failed'),
    {
      type: 'announce' as const,
      messageKey: 'failed',
      players: [...incident.targets],
    },
  ];
}

export const rule: RuleModule = {
  meta: {
    ruleId: 'r0016-daifugo-murder-case',
    name: '大富豪殺人事件',
    description:
      'カード交換完了時、前局の大富豪の左右に座る2人が、使用中のすべての2とジョーカーを共同で持っていれば事件を開始する。手札やカードの内訳は公開せず、対象の2人だけに、2とジョーカーを出さないまま場を3回流すという遂行条件を通知する。3回目の場流れまで対象カードを保持し続けた場合、前局の大富豪をその瞬間に都落ちと同じ扱いで大貧民に確定する。対象の2人のどちらかがそれ以前に2またはジョーカーを出した場合は失敗する。',
    kind: 'local',
    proposalId: '01KZ1A27HRD444CRKCF8118HAS',
    contractVersion: 2,
    messages: {
      started:
        '大富豪殺人事件が始まりました。2とジョーカーを出さずに、場を3回流してください。',
      succeeded: '大富豪殺人事件！ 大富豪は大貧民になりました。',
      failed: '大富豪殺人事件は未遂に終わりました。',
    },
  },
  hooks: {
    onGameStart(context) {
      const previousGame = context.setHistory.at(-1);
      const champion = previousGame?.standings.find(
        ({ standing }) => standing === 1,
      )?.player;
      if (!champion) return [];

      const championSeat = context.game.seats.indexOf(champion);
      const seatCount = context.game.seats.length;
      if (championSeat < 0 || seatCount < 3) return [];

      const left =
        context.game.seats[(championSeat - 1 + seatCount) % seatCount];
      const right = context.game.seats[(championSeat + 1) % seatCount];
      if (!left || !right || left === right) return [];
      const targets: [PlayerId, PlayerId] = [left, right];

      const protectedOwners = context.game.players.flatMap(({ id, hand }) =>
        hand
          .filter(isProtectedCard)
          .map((card) => ({ cardId: card.id, owner: id })),
      );
      if (
        protectedOwners.length === 0 ||
        protectedOwners.some(({ owner }) => !targets.includes(owner))
      ) {
        return [];
      }

      const incident: ActiveIncident = {
        active: true,
        champion,
        targets,
        cardIds: protectedOwners.map(({ cardId }) => cardId).sort(),
        clears: 0,
      };
      return [
        storeIncident(incident),
        {
          type: 'announce',
          messageKey: 'started',
          players: [...targets],
        },
      ];
    },
    afterPlay(context, play) {
      const incident = activeIncident(context);
      if (!incident) return [];

      const actor = context.game.field.current?.by;
      const targetPlayedProtectedCard =
        actor !== undefined &&
        incident.targets.includes(actor) &&
        play.cards.some(isProtectedCard);
      return targetPlayedProtectedCard ||
        !targetsStillHoldAll(context, incident)
        ? failIncident(incident)
        : [];
    },
    afterFieldClear(context) {
      const incident = activeIncident(context);
      if (!incident) return [];
      if (!targetsStillHoldAll(context, incident)) {
        return failIncident(incident);
      }

      const updated = { ...incident, clears: incident.clears + 1 };
      if (updated.clears < REQUIRED_FIELD_CLEARS) {
        return [storeIncident(updated)];
      }

      return [
        closeIncident(updated, 'succeeded'),
        {
          type: 'forceRank',
          player: incident.champion,
          rank: 'lowest',
        },
        { type: 'announce', messageKey: 'succeeded' },
        {
          type: 'announce',
          messageKey: 'succeeded',
          players: [...incident.targets],
        },
      ];
    },
  },
};
