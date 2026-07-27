import { describe, expect, it } from 'vitest';

import { classify } from './rule.js';

describe('valid CX-03 fixture', () => {
  it('negative', () => expect(classify(-1)).toBe('negative'));
  it('zero', () => expect(classify(0)).toBe('zero'));
  it('positive', () => expect(classify(1)).toBe('positive'));
});
