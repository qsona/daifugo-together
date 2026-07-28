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

  it.each(CUES)('%sはふりがなのない1文以内の案内にする', (cue) => {
    const { container } = render(<GuideMessage cue={cue} />);
    const text = container.textContent ?? '';

    expect(text.trim()).not.toBe('');
    expect(text.match(/[。！？!?]/g)?.length ?? 0).toBeLessThanOrEqual(1);
    expect(container.querySelector('ruby')).toBeNull();
    expect(container.querySelector('rt')).toBeNull();
  });
});
