export const PLAYED_BEFORE_STORAGE_KEY = 'daifugo.playedBefore';

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem'>;

export type PlayedBeforeStorage = ReadableStorage & WritableStorage;

export function getPlayedBeforeStorage(
  owner: { readonly localStorage: PlayedBeforeStorage } | null | undefined,
): PlayedBeforeStorage | undefined {
  try {
    return owner?.localStorage;
  } catch {
    return undefined;
  }
}

export function hasPlayedBefore(
  storage: ReadableStorage | null | undefined,
): boolean {
  try {
    return storage?.getItem(PLAYED_BEFORE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function markPlayedBefore(
  storage: WritableStorage | null | undefined,
): void {
  try {
    storage?.setItem(PLAYED_BEFORE_STORAGE_KEY, 'true');
  } catch {
    // Storage may be unavailable or full. Tutorial metadata must not stop play.
  }
}
