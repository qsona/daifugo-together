export function classify(value: number): 'negative' | 'zero' | 'positive' {
  if (value < 0) return 'negative';
  if (value === 0) return 'zero';
  return 'positive';
}
