import type {
  DeepReadonly,
  Play,
  RuleContext,
  RuleModule,
} from '@daifugo/core';

const DIAMOND_THREE_ID = 'D03';

function isFirstPlay(context: RuleContext): boolean {
  return !context.game.history.some((event) => event.type === 'played');
}

function containsDiamondThree(play: DeepReadonly<Play>): boolean {
  return play.cards.some((card) => card.id === DIAMOND_THREE_ID);
}

export const rule: RuleModule = {
  meta: {
    ruleId: 'r0021-starting-gun',
    name: '号砲',
    description:
      'ゲーム開始時はダイヤの3を持つプレイヤーが先手となり、そのゲームの最初の手にはダイヤの3を必ず含めなければならない。',
    kind: 'local',
    prefecture: '東京都',
    proposalId: '01KZ1FQBX1DY3EBGAWYXRKKRF1',
    contractVersion: 1,
    messages: {},
  },
  hooks: {
    modifyLegality(context, play, base) {
      if (!base.legal || !isFirstPlay(context) || containsDiamondThree(play)) {
        return base;
      }
      return { legal: false };
    },
  },
};
