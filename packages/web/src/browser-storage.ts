export type SafeBrowserStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem'
>;

const UNAVAILABLE_STORAGE: SafeBrowserStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

export function getSafeLocalStorage(
  owner: { readonly localStorage: SafeBrowserStorage } | null | undefined,
): SafeBrowserStorage {
  let storage: SafeBrowserStorage;
  try {
    if (!owner) return UNAVAILABLE_STORAGE;
    storage = owner.localStorage;
  } catch {
    return UNAVAILABLE_STORAGE;
  }
  return {
    getItem: (key) => {
      try {
        return storage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem: (key, value) => {
      try {
        storage.setItem(key, value);
      } catch {
        // Storage policies and quota errors must not stop the application.
      }
    },
    removeItem: (key) => {
      try {
        storage.removeItem(key);
      } catch {
        // A live anonymous session is still possible without persistence.
      }
    },
  };
}
