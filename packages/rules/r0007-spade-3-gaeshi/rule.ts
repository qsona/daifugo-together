import type {
  DeepReadonly,
  Play,
  RuleContext,
  RuleModule,
} from '@daifugo/core';

function isSingleJoker(play: DeepReadonly<Play> | undefined): boolean {
  return (
    play?.kind === 'single' &&
    play.count === 1 &&
    play.cards.length === 1 &&
    play.cards[0]?.kind === 'joker'
  );
}

function isSingleSpadeThree(play: DeepReadonly<Play>): boolean {
  const card = play.cards[0];
  return (
    play.kind === 'single' &&
    play.count === 1 &&
    play.cards.length === 1 &&
    card?.kind === 'natural' &&
    card.suit === 'spade' &&
    card.rank === '3'
  );
}

function previousPlay(context: RuleContext): DeepReadonly<Play> | undefined {
  for (let index = context.game.history.length - 1; index >= 0; index -= 1) {
    const event = context.game.history[index];
    if (event?.type === 'played') {
      return event.play;
    }
  }
  return undefined;
}

export const rule: RuleModule = {
  meta: {
    ruleId: 'r0007-spade-3-gaeshi',
    name: 'スペ3返し',
    description:
      '場に単体で出された1枚のジョーカーに対して、スペードの3を単体で出せるようにし、その場合だけジョーカーより強く扱う。成立後は場を流し、スペードの3を出したプレイヤーが次の場を開始する。',
    kind: 'local',
    proposalId: '01KYQNNS3GCP8MYKAW9TJGC0EM',
    contractVersion: 1,
    messages: {},
  },
  hooks: {
    modifyStrength(context, base) {
      if (!isSingleJoker(context.game.field.current?.play)) {
        return base;
      }

      return {
        ...base,
        comparisonOverrides: [
          ...(base.comparisonOverrides ?? []),
          { stronger: '3', weaker: 'joker' },
        ],
      };
    },
    modifyLegality(context, play, base) {
      if (!isSingleJoker(context.game.field.current?.play)) {
        return base;
      }
      if (isSingleSpadeThree(play)) {
        return { legal: true };
      }

      return play.kind === 'single' && play.count === 1 && play.repRank === '3'
        ? { legal: false }
        : base;
    },
    afterPlay(context, play) {
      return isSingleJoker(previousPlay(context)) && isSingleSpadeThree(play)
        ? [{ type: 'clearField' }]
        : [];
    },
  },
};
