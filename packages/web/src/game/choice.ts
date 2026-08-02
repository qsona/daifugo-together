type ChoicePresentationInput = {
  choiceId: string;
  count: number;
  message: string | null;
  ruleName: string | null;
};

export type ChoicePresentation = {
  ruleName: string;
  instruction: string;
  confirmLabel: string;
};

const CHOICE_VERBS: Readonly<Record<string, string>> = {
  lucky_seven_choice: '捨てる',
  seven_pass_choice: '渡す',
  ten_discard_choice: '捨てる',
};

/**
 * ルール入力中の案内と確定ボタンを、一貫した言葉にする。
 * 未知の choice は操作を決めつけず「決定する」と表示する。
 */
export function choicePresentation({
  choiceId,
  count,
  message,
  ruleName,
}: ChoicePresentationInput): ChoicePresentation {
  const resolvedRuleName = ruleName ?? 'ルール';
  const messagePrefix = `${resolvedRuleName}:`;
  const instruction = message?.startsWith(messagePrefix)
    ? message.slice(messagePrefix.length).trim()
    : (message ?? `カードを${String(count)}枚えらんでください`);
  const verb = CHOICE_VERBS[choiceId] ?? '決定する';

  return {
    ruleName: resolvedRuleName,
    instruction,
    confirmLabel: `${resolvedRuleName}で${String(count)}枚${verb}`,
  };
}
