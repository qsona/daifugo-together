#!/usr/bin/env node
/**
 * favicon / OGP の PNG を 2A 由来の SVG から生成する(E04 §2.1.2)。
 *
 * 生成物はリポジトリにコミットする。ビルド時に毎回生成する必要はなく、
 * 実行時の外部サービス・外部フォント依存を持たないことを優先する。
 * 変更するときだけ手で実行する:
 *
 *   node scripts/generate-design-images.mjs
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const designDir = join(repoRoot, 'docs/design');
const outDir = join(repoRoot, 'packages/web/public');

/** 2A のベース色(深い青空)。design-tokens.css の --color-blue-500 と同値。 */
const BASE_COLOR = { r: 0x2b, g: 0x6f, b: 0xc2, alpha: 1 };

const FAVICON_SIZES = [
  ['favicon-32.png', 32],
  ['apple-touch-icon-180.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
];

/** OGP の標準サイズ(≒1.9:1)。企画書 §6「横長は告知・共有用」。 */
const OGP_WIDTH = 1200;
const OGP_HEIGHT = 630;

async function generateFavicons() {
  const svg = readFileSync(join(designDir, 'favicon.svg'));
  for (const [name, size] of FAVICON_SIZES) {
    await sharp(svg, { density: 384 })
      .resize(size, size)
      .png()
      .toFile(join(outDir, name));
    console.log(`  ${name} (${String(size)}x${String(size)})`);
  }
}

/**
 * OGP は暫定版: 9:16 のタイトルを横長カンバスに中央配置し、左右をベース色で埋める。
 * 2A トーンの横長構図の新規制作は未決事項(E04 §5-2)。
 */
async function generateOgp() {
  const kv = await sharp(join(designDir, 'key-visual-2a.svg'), { density: 96 })
    .resize({ height: OGP_HEIGHT })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: OGP_WIDTH,
      height: OGP_HEIGHT,
      channels: 4,
      background: BASE_COLOR,
    },
  })
    .composite([{ input: kv, gravity: 'center' }])
    .png()
    .toFile(join(outDir, 'ogp.png'));

  console.log(`  ogp.png (${String(OGP_WIDTH)}x${String(OGP_HEIGHT)}) 暫定版`);
}

async function copyFaviconSvg() {
  // モダンブラウザ向けのベクタ favicon。PNG は後方互換用。
  writeFileSync(
    join(outDir, 'favicon.svg'),
    readFileSync(join(designDir, 'favicon.svg')),
  );
  console.log('  favicon.svg (docs/design からのコピー)');
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  console.log('デザイン画像を生成します:');
  await generateFavicons();
  await copyFaviconSvg();
  await generateOgp();
  console.log('完了。生成物は packages/web/public/ にコミットしてください。');
}

await main();
