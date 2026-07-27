export const PLAYED_BEFORE_STORAGE_KEY = 'daifugo.playedBefore';

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem'>;

export type PlayedBeforeStorage = ReadableStorage & WritableStorage;

export function hasPlayedBefore(
  storage: ReadableStorage | null | undefined,
): boolean {
  return storage?.getItem(PLAYED_BEFORE_STORAGE_KEY) === 'true';
}

export function markPlayedBefore(
  storage: WritableStorage | null | undefined,
): void {
  storage?.setItem(PLAYED_BEFORE_STORAGE_KEY, 'true');
}
