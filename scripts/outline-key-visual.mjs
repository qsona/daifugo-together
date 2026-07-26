/**
 * キービジュアルのテキストをアウトライン(パス)化した派生 SVG を生成する。
 * 出力: docs/design/key-visual-2a-outlined.svg
 *
 * なぜ要るか(E04 §2.1.1・§5-1):
 * 原資産のロゴ・コピーはライブテキストで、丸ゴシック系のフォント指定に頼っている。
 * SVG を `<img>` で読み込むと親ドキュメントの @font-face が届かないので、
 * Web フォントを同梱していても**閲覧端末にインストールされたフォント**で字形が決まる。
 * macOS では Hiragino Maru Gothic ProN が拾われるが、Windows / Android では
 * 丸ゴシックが当たらず、ブランドの核であるロゴの見えが崩れる。
 * パス化すればどの端末でも同じ字形になる。
 *
 * 原資産(ライブテキスト版)は編集用として残し、配布用は生成物を使う。
 * 文言や配置を変えたらこのスクリプトを流し直すこと。
 *
 * 使い方: node scripts/outline-key-visual.mjs
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import opentype from 'opentype.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const designDir = join(repoRoot, 'docs/design');
const source = join(designDir, 'key-visual-2a.svg');
const output = join(designDir, 'key-visual-2a-outlined.svg');

/** KV のテキストはすべて font-weight="bold" なので 700 だけを使う。 */
const WEIGHT = '700';

function fontDir() {
  const base = join(repoRoot, 'node_modules/.pnpm');
  const pkg = readdirSync(base).find((d) =>
    d.startsWith('@fontsource+m-plus-rounded-1c@'),
  );
  if (!pkg) throw new Error('@fontsource/m-plus-rounded-1c が見つかりません');
  return join(base, pkg, 'node_modules/@fontsource/m-plus-rounded-1c');
}

/**
 * WOFF1 を sfnt(TTF)に戻す。テーブルは zlib 圧縮なので Node 標準の zlib で解ける
 * (WOFF2 は brotli + テーブル変換が要るのでこちらを使う)。
 */
function woffToSfnt(buf) {
  if (buf.toString('latin1', 0, 4) !== 'wOFF') throw new Error('WOFF ではない');
  const numTables = buf.readUInt16BE(12);
  const entries = [];
  for (let i = 0; i < numTables; i += 1) {
    const p = 44 + i * 20;
    entries.push({
      tag: buf.subarray(p, p + 4),
      offset: buf.readUInt32BE(p + 4),
      compLength: buf.readUInt32BE(p + 8),
      origLength: buf.readUInt32BE(p + 12),
      checksum: buf.readUInt32BE(p + 16),
    });
  }

  const bodies = entries.map((e) => {
    const raw = buf.subarray(e.offset, e.offset + e.compLength);
    return e.compLength < e.origLength ? inflateSync(raw) : raw;
  });

  const headerSize = 12 + numTables * 16;
  let offset = headerSize;
  const offsets = bodies.map((b) => {
    const at = offset;
    offset += (b.length + 3) & ~3;
    return at;
  });

  const out = Buffer.alloc(offset);
  out.writeUInt32BE(buf.readUInt32BE(4), 0); // flavor
  out.writeUInt16BE(numTables, 4);
  const pow2 = 2 ** Math.floor(Math.log2(numTables));
  out.writeUInt16BE(pow2 * 16, 6);
  out.writeUInt16BE(Math.floor(Math.log2(numTables)), 8);
  out.writeUInt16BE((numTables - pow2) * 16, 10);

  entries.forEach((e, i) => {
    const p = 12 + i * 16;
    e.tag.copy(out, p);
    out.writeUInt32BE(e.checksum, p + 4);
    out.writeUInt32BE(offsets[i], p + 8);
    out.writeUInt32BE(e.origLength, p + 12);
    bodies[i].copy(out, offsets[i]);
  });

  return out;
}

/** サブセット css の unicode-range から「どの符号位置がどのファイルにあるか」を引く。 */
function loadSubsets() {
  const dir = fontDir();
  const css = readFileSync(join(dir, `${WEIGHT}.css`), 'utf8');
  const blocks = [
    ...css.matchAll(
      /src:\s*url\(\.\/files\/([^)]+?)\.woff2\)[\s\S]*?unicode-range:\s*([^;]+);/g,
    ),
  ];

  return blocks.map(([, name, ranges]) => ({
    file: join(dir, 'files', `${name}.woff`),
    ranges: ranges.split(',').map((part) => {
      const token = part.trim().replace(/^U\+/i, '');
      if (token.includes('-')) {
        const [a, b] = token.split('-');
        return [parseInt(a, 16), parseInt(b, 16)];
      }
      if (token.includes('?')) {
        return [
          parseInt(token.replaceAll('?', '0'), 16),
          parseInt(token.replaceAll('?', 'F'), 16),
        ];
      }
      const cp = parseInt(token, 16);
      return [cp, cp];
    }),
  }));
}

/** 必要な符号位置を含むサブセットだけを読み込む(全 119 個は読まない)。 */
function loadFonts(codepoints) {
  const subsets = loadSubsets();
  const needed = new Set();
  for (const cp of codepoints) {
    const hit = subsets.find((s) =>
      s.ranges.some(([lo, hi]) => cp >= lo && cp <= hi),
    );
    if (!hit)
      throw new Error(`サブセットが見つかりません: U+${cp.toString(16)}`);
    needed.add(hit.file);
  }

  return [...needed].map((file) =>
    opentype.parse(
      woffToSfnt(readFileSync(file)).buffer.slice(0) /* ArrayBuffer 化 */,
    ),
  );
}

function glyphFor(fonts, char) {
  for (const font of fonts) {
    const glyph = font.charToGlyph(char);
    if (glyph && glyph.index !== 0) return { font, glyph };
  }
  throw new Error(`字形が見つかりません: ${char}`);
}

/**
 * 1 つの <text> をパスに変換する。
 * 字送りは CSS と同じく「各文字のあとに letter-spacing を足す」で計算し、
 * text-anchor の基準幅にも末尾の分を含める(ブラウザの実装に合わせる)。
 */
function textToPath(fonts, text, { x, y, fontSize, letterSpacing, anchor }) {
  const chars = [...text];
  const metrics = chars.map((char) => {
    const { font, glyph } = glyphFor(fonts, char);
    return {
      font,
      glyph,
      advance:
        (glyph.advanceWidth / font.unitsPerEm) * fontSize + letterSpacing,
    };
  });

  const total = metrics.reduce((sum, m) => sum + m.advance, 0);
  let penX = x;
  if (anchor === 'middle') penX -= total / 2;
  else if (anchor === 'end') penX -= total;

  const parts = [];
  for (const m of metrics) {
    const path = m.glyph.getPath(penX, y, fontSize);
    const d = path.toPathData(2);
    if (d) parts.push(d);
    penX += m.advance;
  }
  return parts.join(' ');
}

/** <g>/<svg> から継承する属性だけを追う軽いスキャナ。 */
function inheritedAttrs(svg, index) {
  const stack = [{}];
  const tagRe = /<(\/?)(svg|g)\b([^>]*)>/g;
  let match;
  while ((match = tagRe.exec(svg)) !== null) {
    if (match.index >= index) break;
    const [full, closing, , attrs] = match;
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const own = {};
    for (const [, key, value] of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) {
      own[key] = value;
    }
    stack.push({ ...stack.at(-1), ...own });
    if (full.endsWith('/>')) stack.pop();
  }
  return stack.at(-1);
}

const CONSUMED = new Set([
  'x',
  'y',
  'font-size',
  'font-weight',
  'font-family',
  'letter-spacing',
  'text-anchor',
]);

export function buildOutlinedSvg() {
  const svg = readFileSync(source, 'utf8');

  const texts = [...svg.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)];
  if (texts.length === 0) throw new Error('<text> が見つかりません');

  const codepoints = new Set();
  for (const [, , content] of texts) {
    for (const char of content) codepoints.add(char.codePointAt(0));
  }
  const fonts = loadFonts(codepoints);

  let out = svg;
  // 後ろから置換して、前方のインデックスをずらさない。
  for (const match of [...texts].reverse()) {
    const [full, attrText, content] = match;
    const own = {};
    for (const [, key, value] of attrText.matchAll(/([\w-]+)="([^"]*)"/g)) {
      own[key] = value;
    }
    const inherited = inheritedAttrs(svg, match.index);
    const effective = { ...inherited, ...own };

    const d = textToPath(fonts, content, {
      x: Number(own.x ?? 0),
      y: Number(own.y ?? 0),
      fontSize: Number(effective['font-size'] ?? 16),
      letterSpacing: Number(effective['letter-spacing'] ?? 0),
      anchor: effective['text-anchor'] ?? 'start',
    });

    const kept = Object.entries(own)
      .filter(([key]) => !CONSUMED.has(key))
      .map(([key, value]) => ` ${key}="${value}"`)
      .join('');

    out =
      out.slice(0, match.index) +
      `<path${kept} d="${d}"/>` +
      out.slice(match.index + full.length);
  }

  // フォント関連の属性はもう効かない(パスなので端末のフォントに依存しない)。
  out = out.replace(/\n?\s*font-family="[^"]*"/, '');
  out = out.replaceAll(
    / (?:font-size|font-weight|text-anchor|letter-spacing)="[^"]*"/g,
    '',
  );
  out = out.replace(
    '<title>',
    '<!-- 生成物: scripts/outline-key-visual.mjs。編集は key-visual-2a.svg 側で行うこと -->\n  <title>',
  );

  return { svg: out, count: texts.length };
}

function main() {
  const { svg, count } = buildOutlinedSvg();
  const isCheck = process.argv.includes('--check');

  if (isCheck) {
    // 正本を編集して生成し直し忘れると、配布物だけ古い字形のまま残る。
    const current = readFileSync(output, 'utf8');
    if (current !== svg) {
      console.error(
        'アウトライン版が key-visual-2a.svg と一致しません。' +
          'node scripts/outline-key-visual.mjs を実行してください',
      );
      process.exit(1);
    }
    console.log(`アウトライン版 OK(${String(count)} 件のテキストがパス化済み)`);
    return;
  }

  writeFileSync(output, svg);
  console.log(
    `アウトライン化 OK: ${String(count)} 件のテキストをパスに変換` +
      `(${String(readFileSync(source).length)} → ${String(Buffer.byteLength(svg))} bytes)`,
  );
  execFileSync('xmllint', ['--noout', output]);
  console.log('well-formed OK:', output.replace(repoRoot, ''));
}

main();
