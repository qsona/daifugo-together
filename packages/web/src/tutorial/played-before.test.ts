import { describe, expect, it, vi } from 'vitest';

import {
  getPlayedBeforeStorage,
  hasPlayedBefore,
  markPlayedBefore,
  PLAYED_BEFORE_STORAGE_KEY,
} from './played-before';

describe('TU-01: 既プレイ端末の記録', () => {
  it('保存値がtrueのときだけ既プレイとみなす', () => {
    expect(
      hasPlayedBefore({
        getItem: (key) => (key === PLAYED_BEFORE_STORAGE_KEY ? 'true' : null),
      }),
    ).toBe(true);
    expect(hasPlayedBefore({ getItem: () => 'false' })).toBe(false);
    expect(hasPlayedBefore(undefined)).toBe(false);
  });

  it('localStorageの読み取りが例外でも未プレイとして続行する', () => {
    expect(
      hasPlayedBefore({
        getItem: () => {
          throw new DOMException('Blocked', 'SecurityError');
        },
      }),
    ).toBe(false);
  });

  it('window.localStorage自体を取得できなくても保存なしで続行する', () => {
    const owner = Object.defineProperty({}, 'localStorage', {
      get: () => {
        throw new DOMException('Blocked', 'SecurityError');
      },
    }) as { readonly localStorage: Storage };

    expect(getPlayedBeforeStorage(owner)).toBeUndefined();
  });

  it('localStorageの書き込みが例外でも対局処理へ例外を漏らさない', () => {
    const setItem = vi.fn(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });

    expect(() => markPlayedBefore({ setItem })).not.toThrow();
    expect(setItem).toHaveBeenCalledWith(PLAYED_BEFORE_STORAGE_KEY, 'true');
  });
});
