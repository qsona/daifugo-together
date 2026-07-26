import { describe, expect, it } from 'vitest';

// @ts-expect-error -- 検査スクリプトは .mjs のまま(TS-02 の check-rule-diff と同じ方針)
import {
  checkFaviconCopy,
  findViolations,
  readToken,
} from './check-design-tokens.mjs';

const TOKENS = `
:root {
  --color-blue-500: #2B6FC2;
  --color-bg-brand: var(--color-blue-500);
}
`;

const THEME_OK = '<meta name="theme-color" content="#2B6FC2" />';

function run(files: Record<string, string>, htmlText = THEME_OK): string[] {
  return findViolations({
    files: Object.keys(files),
    readFile: (file: string) => files[file],
    htmlText,
    tokensText: TOKENS,
  }) as string[];
}

describe('readToken', () => {
  it('var() 参照をたどってプリミティブの実値まで解決する', () => {
    expect(readToken(TOKENS, '--color-bg-brand')).toBe('#2B6FC2');
  });
});

describe('生の色の検出', () => {
  it('16 進カラーの直書きを検出する', () => {
    const violations = run({ 'a.css': '.x { color: #1C2447; }' });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('a.css:1');
  });

  it('rgba() の直書きを検出する', () => {
    expect(
      run({ 'a.css': '.x { outline: 3px solid rgba(1,2,3,.3); }' }),
    ).toHaveLength(1);
  });

  it('TSX 内の直書きも検出する', () => {
    expect(run({ 'a.tsx': '<svg fill="#FFC53D" />' })).toHaveLength(1);
  });

  it('var() 経由の参照は通す', () => {
    expect(
      run({ 'a.css': '.x { color: var(--color-text-primary); }' }),
    ).toEqual([]);
  });

  it('color-mix でトークンから派生させるのは通す', () => {
    const css =
      '.x { outline-color: color-mix(in srgb, var(--color-focus-ring) 30%, transparent); }';
    expect(run({ 'a.css': css })).toEqual([]);
  });

  it('コメント内の色は指摘しない(出典の記録に使うため)', () => {
    expect(run({ 'a.css': '  /* KV: #2B6FC2 深い青空 */' })).toEqual([]);
  });

  it('CSS 名前色の直書きを検出する', () => {
    expect(run({ 'a.css': '.x { color: white; }' })).toHaveLength(1);
    expect(run({ 'a.css': '.x { box-shadow: var(--s) gold; }' })).toHaveLength(
      1,
    );
  });

  it('新しい色空間の関数も検出する', () => {
    expect(run({ 'a.css': '.x { color: oklch(70% .1 200); }' })).toHaveLength(
      1,
    );
  });

  it('トークン名やプロパティ名に色語が含まれるのは誤検出しない', () => {
    const files = {
      'a.css':
        '.x { background: var(--color-white); border: var(--color-red-500); }',
      'b.tsx': 'const c = isRed ? styles.red : styles.black;',
    };
    expect(run(files)).toEqual([]);
  });

  it('transparent と currentColor はトークンの代わりではないので通す', () => {
    expect(
      run({ 'a.css': '.x { background: transparent; stroke: currentColor; }' }),
    ).toEqual([]);
  });
});

describe('border-radius のトークン強制', () => {
  it('トークンにない px 直値を検出する', () => {
    const violations = run({ 'a.css': '.x { border-radius: 4px; }' });
    expect(violations.some((v) => v.includes('border-radius'))).toBe(true);
  });

  it('トークン参照・calc・50%・0 は通す', () => {
    const css = [
      '.a { border-radius: var(--radius-l); }',
      '.b { border-radius: calc(var(--radius-l) - 5px); }',
      '.c { border-radius: 50%; }',
      '.d { border-radius: 0; }',
    ].join('\n');
    expect(run({ 'a.css': css })).toEqual([]);
  });
});

describe('favicon の配布物と正本の照合', () => {
  it('一致していれば通す', () => {
    expect(checkFaviconCopy('<svg/>', '<svg/>')).toEqual([]);
  });

  it('正本だけ更新して生成し忘れた状態を検出する', () => {
    const violations = checkFaviconCopy('<svg a/>', '<svg/>') as string[];
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('generate-design-images');
  });
});

describe('box-shadow のトークン強制', () => {
  it('手書きの影を検出する', () => {
    const violations = run({ 'a.css': '.x { box-shadow: 0 3px 0 black; }' });
    expect(violations.some((v) => v.includes('box-shadow'))).toBe(true);
  });

  it('トークン参照と none は通す', () => {
    expect(
      run({
        'a.css':
          '.x { box-shadow: var(--shadow-hard-m); }\n.y { box-shadow: none; }',
      }),
    ).toEqual([]);
  });
});

describe('index.html の theme-color 照合', () => {
  it('トークンの実値とずれていたら検出する', () => {
    const violations = run({}, '<meta name="theme-color" content="#123456" />');
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('theme-color');
  });

  it('一致していれば通す(大文字小文字は無視)', () => {
    expect(run({}, '<meta name="theme-color" content="#2b6fc2" />')).toEqual(
      [],
    );
  });
});
