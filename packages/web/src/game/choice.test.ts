import { describe, expect, it } from 'vitest';

import { choicePresentation } from './choice';

describe('choicePresentation', () => {
  it.each([
    {
      choiceId: 'lucky_seven_choice',
      ruleName: 'ラッキー7',
      message: 'ラッキー7: 捨てるカードを選んでください。',
      confirmLabel: 'ラッキー7で2枚捨てる',
      instruction: '捨てるカードを選んでください。',
    },
    {
      choiceId: 'seven_pass_choice',
      ruleName: '7渡し',
      message: '7渡し: 次の人に渡すカードを選んでください。',
      confirmLabel: '7渡しで2枚渡す',
      instruction: '次の人に渡すカードを選んでください。',
    },
  ])(
    '$ruleNameのルール名と操作を区別して表示する',
    ({ choiceId, ruleName, message, confirmLabel, instruction }) => {
      expect(
        choicePresentation({ choiceId, count: 2, message, ruleName }),
      ).toEqual({ ruleName, instruction, confirmLabel });
    },
  );

  it('未知のchoiceでカードの用途を決めつけない', () => {
    expect(
      choicePresentation({
        choiceId: 'future_choice',
        count: 1,
        message: null,
        ruleName: '新ルール',
      }),
    ).toEqual({
      ruleName: '新ルール',
      instruction: 'カードを1枚えらんでください',
      confirmLabel: '新ルールで1枚決定する',
    });
  });
});
