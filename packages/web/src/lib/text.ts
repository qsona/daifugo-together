export function clampCodePoints(value: string, maximum: number): string {
  return Array.from(value.normalize('NFC')).slice(0, maximum).join('');
}
