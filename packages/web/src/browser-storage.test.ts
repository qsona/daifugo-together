import { describe, expect, it, vi } from 'vitest';

import { getSafeLocalStorage } from './browser-storage';

describe('getSafeLocalStorage', () => {
  it('localStorageプロパティ自体が拒否されてもno-op storageを返す', () => {
    const owner = Object.defineProperty({}, 'localStorage', {
      get: () => {
        throw new DOMException('Blocked', 'SecurityError');
      },
    }) as { readonly localStorage: Storage };

    const storage = getSafeLocalStorage(owner);
    expect(storage.getItem('key')).toBeNull();
    expect(() => storage.setItem('key', 'value')).not.toThrow();
    expect(() => storage.removeItem('key')).not.toThrow();
  });

  it('storage各操作の例外をクライアントへ漏らさない', () => {
    const source = {
      getItem: vi.fn(() => {
        throw new DOMException('Blocked', 'SecurityError');
      }),
      setItem: vi.fn(() => {
        throw new DOMException('Full', 'QuotaExceededError');
      }),
      removeItem: vi.fn(() => {
        throw new DOMException('Blocked', 'SecurityError');
      }),
    };
    const storage = getSafeLocalStorage({ localStorage: source });

    expect(storage.getItem('key')).toBeNull();
    expect(() => storage.setItem('key', 'value')).not.toThrow();
    expect(() => storage.removeItem('key')).not.toThrow();
  });
});
