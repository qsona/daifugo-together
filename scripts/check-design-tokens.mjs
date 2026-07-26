#!/usr/bin/env node
/**
 * デザイントークン準拠の静的検査(E04 §2.3(3)・§4-1)。
 *
 * トーン崩れの最大の原因は「場当たりの色直書き」なので、そこを機械的に止める。
 *
 *  1. `packages/web/src` の CSS/TS/TSX に生の色(16 進・rgb/rgba/hsl/hsla)を書かせない。
 *     色は必ず design-tokens.css のカスタムプロパティ経由(`var(--…)`)で参照する。
 *  2. CSS の `box-shadow` は必ずトークン参照か `none`。
 *     ベタ落ち影は 2A の造形文法そのものなので、手書きの影を許すとトーンが崩れる。
 *  3. `index.html` の `theme-color` は CSS 変数が使えないため生の色を書くしかない。
 *     値がトークン(--color-bg-brand の実値)からずれていないかをここで照合する。
 *
 * px の直値は検査しない。トークン化されているのは余白・角丸・輪郭線幅で、
 * レイアウト寸法(部品の幅・高さ)は本来トークンの対象外のため、
 * 一律に禁止すると偽陽性ばかりになる(design-system.html の見本自身が px を使っている)。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const srcDir = join(repoRoot, 'packages/web/src');
const indexHtml = join(repoRoot, 'packages/web/index.html');
const tokensCss = join(repoRoot, 'docs/design/design-tokens.css');

const SCANNED_EXTENSIONS = ['.css', '.ts', '.tsx'];

const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\s*\(/;
const BOX_SHADOW = /box-shadow\s*:\s*([^;}]+)/g;

/** 行内に検査対象外の記述があるか(コメントは対象外)。 */
function isComment(line) {
  const trimmed = line.trim();
  return (
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('//')
  );
}

function collectFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...collectFiles(path));
    } else if (SCANNED_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      found.push(path);
    }
  }
  return found.sort();
}

/** design-tokens.css から `--name: value;` を読む(var() 参照は解決する)。 */
export function readToken(cssText, name) {
  const declarations = new Map();
  const pattern = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let match;
  while ((match = pattern.exec(cssText)) !== null) {
    declarations.set(match[1], match[2].trim());
  }

  const seen = new Set();
  let value = declarations.get(name);
  while (value !== undefined && value.startsWith('var(')) {
    const referenced = /var\(\s*(--[\w-]+)/.exec(value)?.[1];
    if (referenced === undefined || seen.has(referenced)) return undefined;
    seen.add(referenced);
    value = declarations.get(referenced);
  }
  return value;
}

export function findViolations({ files, readFile, htmlText, tokensText }) {
  const violations = [];

  for (const file of files) {
    const lines = readFile(file).split('\n');
    lines.forEach((line, index) => {
      if (isComment(line)) return;
      const at = `${file}:${String(index + 1)}`;

      if (RAW_COLOR.test(line)) {
        violations.push(
          `${at} 生の色が書かれています。design-tokens.css の var(--…) を使ってください: ${line.trim()}`,
        );
      }
    });

    if (file.endsWith('.css')) {
      const text = readFile(file);
      for (const match of text.matchAll(BOX_SHADOW)) {
        const value = match[1].trim();
        if (!value.startsWith('var(') && value !== 'none') {
          violations.push(
            `${file} box-shadow はトークン参照か none にしてください(ベタ落ち影は 2A の造形文法): ${value}`,
          );
        }
      }
    }
  }

  // index.html の theme-color はトークンの実値と一致していること。
  const themeColor = /<meta\s+name="theme-color"\s+content="([^"]+)"/.exec(
    htmlText,
  )?.[1];
  const brandColor = readToken(tokensText, '--color-bg-brand');
  if (themeColor !== undefined && brandColor !== undefined) {
    if (themeColor.toLowerCase() !== brandColor.toLowerCase()) {
      violations.push(
        `packages/web/index.html theme-color(${themeColor})が --color-bg-brand(${brandColor})と一致しません`,
      );
    }
  }

  return violations;
}

function main() {
  const files = collectFiles(srcDir);
  const violations = findViolations({
    files,
    readFile: (file) => readFileSync(file, 'utf8'),
    htmlText: readFileSync(indexHtml, 'utf8'),
    tokensText: readFileSync(tokensCss, 'utf8'),
  }).map((message) => message.replaceAll(repoRoot, ''));

  if (violations.length > 0) {
    console.error('デザイントークン準拠の検査に失敗しました:\n');
    for (const violation of violations) console.error(`  - ${violation}`);
    console.error(
      `\n${String(violations.length)} 件。色・影はすべて docs/design/design-tokens.css のトークン経由で参照してください。`,
    );
    process.exit(1);
  }

  console.log(
    `デザイントークン準拠 OK(${String(files.length)} ファイルを検査)`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

export { collectFiles };
