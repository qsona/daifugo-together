/**
 * 複数ファイルで重複しているUI文言の定数。
 * 表記を直すときに一部のコピーだけが取り残される事故を防ぐため、
 * 重複が確認された文言はここに集約し、使用箇所からはこれを参照する。
 * (docs/design/ui-writing-style-guide.md §11.3)
 */

export const RETRY_GENERIC_ERROR =
  'うまくいきませんでした。もう一度ためしてください。';

export const RATING_SUBMIT_ERROR =
  '評価を送れませんでした。もう一度ためしてください。';

export const PROPOSAL_LIST_LOAD_ERROR = '提案一覧を取得できませんでした';

export const PROPOSE_RULE_LABEL = 'ルールを提案する';

export const JOIN_FRIEND_ROOM_LABEL = '友だちの部屋にはいる';
