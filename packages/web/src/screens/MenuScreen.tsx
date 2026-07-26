import styles from './MenuScreen.module.css';

/**
 * 画面 1b: メニュー。
 * プロセス1 ではタイトルからの遷移先が存在することだけを示すスタブ。
 * 導線ボタン群(あそぶ/提案/図鑑/マイ提案/あそびかた)とコアコンセプト一文の
 * トーン適用は DS-02(E04 §3.2 の対応表)で作る。
 */
export function MenuScreen() {
  return (
    <main className={styles.screen}>
      <h1 className={styles.title}>メニュー</h1>
      <p className={styles.note}>
        画面 1b。導線ボタン群のトーン適用は DS-02 で実装します。
      </p>
    </main>
  );
}
