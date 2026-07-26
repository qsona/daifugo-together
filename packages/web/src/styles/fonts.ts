/*
 * 本文フォント。トーンの核である丸ゴシックを端末依存にしないためセルフホストする
 * (外部 CDN は実行時の外部依存になるので採らない。E12 §2 運用物最小)。
 *
 * 各 css は unicode-range で 126 分割されたサブセットを宣言するので、
 * 実際に描画された字のサブセットだけがダウンロードされる。
 * ただし宣言そのものが 3 ウェイトで 450KB 級になるため、
 * このモジュールは main.tsx から動的 import して初回描画の経路から外す。
 * font-display: swap なので、読み込み前は design-tokens.css のフォールバック
 * (Hiragino Maru Gothic ProN 以降)で成立し、読み込み後に差し替わる。
 */

import '@fontsource/m-plus-rounded-1c/400.css';
import '@fontsource/m-plus-rounded-1c/700.css';
import '@fontsource/m-plus-rounded-1c/800.css';
