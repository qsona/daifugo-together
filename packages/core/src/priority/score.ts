export const POPULARITY_PRIOR = { alpha: 5, beta: 5 } as const;

export function computePopularityScore(up: number, down: number): number {
  if (
    !Number.isSafeInteger(up) ||
    !Number.isSafeInteger(down) ||
    up < 0 ||
    down < 0
  ) {
    throw new Error('Popularity counts must be non-negative integers');
  }
  return (
    (up + POPULARITY_PRIOR.alpha) /
    (up + down + POPULARITY_PRIOR.alpha + POPULARITY_PRIOR.beta)
  );
}
