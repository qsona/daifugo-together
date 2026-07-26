import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

// @ts-expect-error -- 検査スクリプトは .mjs のまま(TS-02 の check-rule-diff と同じ方針)
import { checkSvgText } from './check-key-visual.mjs';

const check = (text: string): string[] =>
  checkSvgText('t.svg', text) as string[];

describe('キービジュアル SVG の静的検証', () => {
  it('確定済みの原資産 key-visual-2a.svg は自己完結している', () => {
    const text = readFileSync('docs/design/key-visual-2a.svg', 'utf8');
    expect(check(text)).toEqual([]);
  });

  it('xmlns は名前空間なので外部参照と見なさない', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>';
    expect(check(svg)).toEqual([]);
  });

  it('内部参照(#id)の use は通す', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><use xlink:href="#ray"/></svg>';
    expect(check(svg)).toEqual([]);
  });

  it('外部画像の参照を検出する', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><image href="https://example.com/a.png"/></svg>';
    expect(check(svg).some((p) => p.includes('外部参照'))).toBe(true);
  });

  it('外部フォントの @import を検出する', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><style>@import url(x.css);</style></svg>';
    expect(check(svg).some((p) => p.includes('外部参照'))).toBe(true);
  });

  it('viewBox が無ければ検出する', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    expect(check(svg).some((p) => p.includes('viewBox'))).toBe(true);
  });
});
