/**
 * 複数ファイルで重複しているUI文言の定数。
 * 表記を直すときに一部のコピーだけが取り残される事故を防ぐため、
 * 重複が確認された文言はここに集約し、使用箇所からはこれを参照する。
 * (docs/design/ui-writing-style-guide.md §11.3)
 */

export const RETRY_GENERIC_ERROR =
  'うまくいきませんでした。もう一度ためしてください。';
export const RETRY_REQUEST = 'もう一度ためしてください。';
export const GOOGLE_CONNECT_LABEL = 'Googleでつなぐ';
export const SIGN_OUT_LABEL = 'サインアウト';

export const RATING_SUBMIT_ERROR =
  '評価を送れませんでした。もう一度ためしてください。';

export const PROPOSAL_LIST_LOAD_ERROR = '提案一覧を取得できませんでした';

export const PROPOSE_RULE_LABEL = 'ルールを提案する';

export const JOIN_FRIEND_ROOM_LABEL = '友だちの部屋にはいる';

/** 対局中の「やめる」。アプリバーのボタンと確認ダイアログの実行側に同じ語を使う。 */
export const QUIT_GAME_LABEL = 'やめる';

export const QUIT_GAME_TITLE = '対局をやめますか?';

/**
 * みんなのルール(community)だけに出す注記。
 * 席が AI に引き継がれることと、戻れないことは画面から読み取れないので書く。
 * ひとり練習は自分が抜ければ部屋ごと終わるだけなので、注記を置かない。
 */
export const QUIT_GAME_MULTI_DESCRIPTION =
  'あなたの席はAIが引きつぎます。この対局にはもどれません。';

/** 確認ダイアログの取り消し側。押すと元の画面に戻る。 */
export const CONFIRM_BACK_LABEL = 'もどる';

export const LEAVE_ROOM_TITLE = '部屋から出ますか?';

export const LEAVE_ROOM_CONFIRM_LABEL = '出る';
