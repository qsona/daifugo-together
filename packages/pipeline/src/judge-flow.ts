export interface JudgeFlowSteps {
  judge: () => Promise<void>;
  review: () => Promise<void>;
}

export async function runJudgeFlow(
  withReview: boolean,
  steps: JudgeFlowSteps,
): Promise<void> {
  await steps.judge();
  if (withReview) await steps.review();
}
