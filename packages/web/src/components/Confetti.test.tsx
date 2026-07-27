import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Confetti } from './Confetti';
import styles from './Confetti.module.css';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Confetti', () => {
  it('装飾なので支援技術には露出しない', () => {
    const view = render(<Confetti />);

    const field = view.container.querySelector(`.${styles.field}`)!;
    expect(field.getAttribute('aria-hidden')).toBe('true');
    expect(field.children.length).toBeGreaterThan(0);
  });

  it('動きを減らす設定では何も描かない', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    );

    const view = render(<Confetti />);

    expect(view.container.firstElementChild).toBeNull();
  });
});
