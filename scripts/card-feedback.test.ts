import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const cardCss = readFileSync(
  new URL('../packages/web/src/components/Card.module.css', import.meta.url),
  'utf8',
);

describe('TU-02: 出せないカードのreduced-motion', () => {
  it('移動を使わず縁の点滅へ置き換える', () => {
    expect(cardCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: reject-edge/,
    );
    const reducedKeyframes = cardCss.match(
      /@keyframes reject-edge\s*\{([\s\S]*?)\n\}/,
    )?.[1];
    expect(reducedKeyframes).toBeDefined();
    expect(reducedKeyframes).toContain('outline:');
    expect(reducedKeyframes).not.toContain('transform:');
  });
});
