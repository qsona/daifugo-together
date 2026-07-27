/**
 * 「動きを減らす」設定。CSS の @media では表せない演出
 * (数のカウントアップ、紙吹雪の DOM 生成)の出し分けに使う。
 * matchMedia を持たない実行環境では false として扱う。
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
