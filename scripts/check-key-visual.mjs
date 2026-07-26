#!/usr/bin/env node
/**
 * キービジュアル SVG の静的検証(E04 §4-2)。
 * キービジュアル提案.md で確立済みの手順を CI に固定する。
 *
 *  1. well-formed であること(`xmllint --noout` 相当。パーサが無い環境ではスキップせず自前で最低限を見る)
 *  2. 外部参照がゼロ = 完全自己完結であること
 *     (外部画像・外部フォント・外部 CSS に依存すると、配布先で見えが壊れる)
 *  3. viewBox が宣言されていること(任意解像度で破綻しないための前提)
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * 検証対象。派生 SVG が増えたらここに足す。
 * **不在は fail** にする。改名や削除で検査が静かに素通りするのを防ぐため
 * (OGP は SVG 正本を持たず generate-design-images.mjs が PNG を合成するので対象外)。
 */
export const TARGETS = [
  'docs/design/key-visual-2a.svg',
  'docs/design/favicon.svg',
];

const EXTERNAL_REFERENCE =
  /(?:https?:)?\/\/|xlink:href\s*=\s*"(?!#)|href\s*=\s*"(?!#)|@import|url\(\s*(?!['"]?#)/;

export function checkSvgText(name, text) {
  const problems = [];

  if (!text.includes('<svg')) {
    problems.push(`${name}: <svg> 要素が見つかりません`);
    return problems;
  }
  if (!/viewBox\s*=/.test(text)) {
    problems.push(`${name}: viewBox が宣言されていません`);
  }

  for (const [index, rawLine] of text.split('\n').entries()) {
    // xmlns は名前空間の識別子であって取得先ではないので検査対象から外す。
    const line = rawLine.replaceAll(/xmlns(:\w+)?\s*=\s*"[^"]*"/g, '');
    if (EXTERNAL_REFERENCE.test(line)) {
      problems.push(
        `${name}:${String(index + 1)}: 外部参照があります(自己完結でなくなります): ${rawLine.trim()}`,
      );
    }
  }

  return problems;
}

function checkWellFormed(path) {
  try {
    execFileSync('xmllint', ['--noout', path], { stdio: 'pipe' });
    return [];
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.warn(
        `  (xmllint が無いため well-formed 検査はスキップ: ${path})`,
      );
      return [];
    }
    return [`${path}: well-formed ではありません\n${String(error.stderr)}`];
  }
}

function main() {
  const problems = [];
  let checked = 0;

  for (const target of TARGETS) {
    const path = join(repoRoot, target);
    if (!existsSync(path)) {
      problems.push(
        `${target}: 検証対象が見つかりません。改名したなら TARGETS も更新してください`,
      );
      continue;
    }
    checked += 1;
    problems.push(...checkWellFormed(path));
    problems.push(...checkSvgText(target, readFileSync(path, 'utf8')));
  }

  if (problems.length > 0) {
    console.error('キービジュアル SVG の検証に失敗しました:\n');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  console.log(`キービジュアル SVG OK(${String(checked)} ファイルを検査)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
