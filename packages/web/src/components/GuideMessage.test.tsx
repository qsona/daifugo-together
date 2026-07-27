import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { GuideCue } from '../game/guide';
import { GuideMessage } from './GuideMessage';

const CUES: readonly GuideCue[] = [
  'firstTurn',
  'followTurn',
  'pairAvailable',
  'noLegalMove',
  'fieldCleared',
];

describe('TU-03: ガイド文言', () => {
  afterEach(cleanup);

  it.each(CUES)('%sは1文以内で、読みが必要な漢字にrubyを持つ', (cue) => {
    const { container } = render(<GuideMessage cue={cue} />);
    const text = container.textContent ?? '';

    expect(text.trim()).not.toBe('');
    expect(text.match(/[。！？!?]/g)?.length ?? 0).toBeLessThanOrEqual(1);
    expect(container.querySelector('ruby')).toBeTruthy();
    for (const ruby of container.querySelectorAll('ruby')) {
      expect(ruby.querySelector('rt')?.textContent?.trim()).not.toBe('');
    }
  });
});
