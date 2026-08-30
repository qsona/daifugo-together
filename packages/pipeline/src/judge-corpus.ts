import type { JudgementVerdict, RejectCategory } from '@daifugo/server';

export interface CxJudgeCorpusCase {
  id: string;
  name: string;
  body: string;
  expected: {
    verdict: JudgementVerdict;
    rejectCategory: RejectCategory | null;
    rejectSubtype: string | null;
    /** 定義したケースだけ、extensionNeeded が非nullかどうかを比較する。 */
    extensionNeeded?: boolean;
  };
  existingRules?: Array<{ name: string; summary: string }>;
}

export const CX_JUDGE_CORPUS: readonly CxJudgeCorpusCase[] = [
  {
    id: 'A1',
    name: '7渡し指名',
    body: '7を出した人は手札を見て好きな1枚を選び、渡す相手も選ぶ。',
    // カード選択＋相手選択の二段階入力は contract v2 で表現できる。
    expected: {
      verdict: 'approve',
      rejectCategory: null,
      rejectSubtype: null,
    },
  },
  {
    id: 'A2',
    name: '勝利コイン',
    body: 'ゲームに勝つたびにコインを3枚もらい、10枚で次の試合に勝つ。',
    expected: {
      verdict: 'needs_review',
      rejectCategory: null,
      rejectSubtype: null,
    },
  },
  {
    id: 'A3',
    name: '二つの場',
    body: '場を二つに分け、各手番でどちらの場にカードを出すか選ぶ。',
    expected: {
      verdict: 'needs_review',
      rejectCategory: null,
      rejectSubtype: null,
    },
  },
  {
    id: 'A4',
    name: '雨の日革命',
    body: '今日の天気が雨なら、ゲーム開始時から革命状態にする。',
    expected: {
      verdict: 'reject',
      rejectCategory: 'contract',
      rejectSubtype: 'A4',
    },
  },
  {
    id: 'B1',
    name: '永久増殖',
    body: '全員の手番が来るたびに、その人の手札を同じ枚数だけ山から増やす。',
    expected: {
      verdict: 'reject',
      rejectCategory: 'game_breaking',
      rejectSubtype: 'B1',
    },
  },
  {
    id: 'B2',
    name: '常時全公開',
    body: 'ゲーム開始から終了まで、全員の手札を全員にすべて公開する。',
    expected: {
      verdict: 'reject',
      rejectCategory: 'game_breaking',
      rejectSubtype: 'B2',
    },
  },
  {
    id: 'B3',
    name: '大貧民永久休み',
    body: '前のゲームで大貧民だった人は、このゲームでは全手番をスキップする。',
    expected: {
      verdict: 'reject',
      rejectCategory: 'game_breaking',
      rejectSubtype: 'B3',
    },
  },
  {
    id: 'B4',
    name: '踊れないと失格',
    body: '8を出されたら全員が実際に踊り、踊らなかった人をゲームから失格にする。',
    expected: {
      verdict: 'reject',
      rejectCategory: 'game_breaking',
      rejectSubtype: 'B4',
    },
  },
  {
    id: 'B5',
    name: 'ポーカーへ変更',
    body: '配られたカードからポーカーの役を作り、役の強さだけで勝敗を決める。',
    expected: {
      verdict: 'reject',
      rejectCategory: 'game_breaking',
      rejectSubtype: 'B5',
    },
  },
  {
    id: 'C1',
    name: '個人攻撃',
    body: '特定の実在個人を侮辱する言葉を毎手番表示して笑いものにする。',
    expected: {
      verdict: 'reject',
      rejectCategory: 'inappropriate',
      rejectSubtype: 'C1',
    },
  },
  {
    id: 'C2',
    name: 'エイトクリア',
    body: '8を出した直後に場を流し、出した人から次の場を始める。',
    existingRules: [
      {
        name: '八切り',
        summary: '8を含むプレイの直後に場を流す。',
      },
    ],
    expected: {
      verdict: 'reject',
      rejectCategory: 'duplicate',
      rejectSubtype: 'C2',
    },
  },
  {
    id: 'C3',
    name: 'ぐるぐる',
    body: 'カードがぽよぽよしたらアレをそうして、いい感じにぐるぐるする。',
    expected: {
      verdict: 'reject',
      rejectCategory: 'unintelligible',
      rejectSubtype: 'C3',
    },
  },
  {
    id: 'P01',
    name: '八切り',
    body: '8を含むカードを出したら場を流す。',
    expected: {
      verdict: 'approve',
      rejectCategory: null,
      rejectSubtype: null,
    },
  },
  {
    id: 'P02',
    name: '五飛び',
    body: '5を出したら次の人の手番を1回だけ飛ばす。',
    expected: {
      verdict: 'approve',
      rejectCategory: null,
      rejectSubtype: null,
    },
  },
  {
    id: 'P03',
    name: '三枚革命',
    body: '同じ数字を3枚同時に出したら、そのゲーム中は数字の強さを逆にする。',
    expected: {
      verdict: 'approve',
      rejectCategory: null,
      rejectSubtype: null,
    },
  },
  {
    id: 'P04',
    name: '開幕反時計回り',
    body: 'ゲーム開始時に手番の進む向きを一度だけ逆にする。',
    expected: {
      verdict: 'approve',
      rejectCategory: null,
      rejectSubtype: null,
    },
  },
  {
    id: 'P05',
    name: 'キング即大富豪',
    body: 'Kを1枚で出してあがった人は、その場で1位になる。',
    expected: {
      verdict: 'approve',
      rejectCategory: null,
      rejectSubtype: null,
    },
  },
  {
    id: 'P06',
    name: 'ランダム7渡し',
    body: '7を出したら自分の手札からランダムな1枚を次の人へ渡す。',
    expected: {
      verdict: 'approve',
      rejectCategory: null,
      rejectSubtype: null,
    },
  },
  {
    id: 'P07',
    name: '踊りのお知らせ',
    body: 'ジョーカーを出したら「みんなでダンス！」と画面に表示するだけ。',
    expected: {
      verdict: 'approve',
      rejectCategory: null,
      rejectSubtype: null,
    },
  },
  {
    id: 'P08',
    name: '一回休み',
    body: 'スペードの3を出された次の人だけ、次の手番を1回休む。',
    expected: {
      verdict: 'approve',
      rejectCategory: null,
      rejectSubtype: null,
    },
  },
  {
    id: 'P09',
    name: '階段',
    body: '同じマークで数字が連続する3枚以上をまとめて出せる。',
    expected: {
      verdict: 'approve',
      rejectCategory: null,
      rejectSubtype: null,
    },
  },
  {
    id: 'P10',
    name: 'ジョーカー',
    body: 'ジョーカーを2枚入れる。1枚なら最強で、他のカードの代わりにも使える。',
    expected: {
      verdict: 'approve',
      rejectCategory: null,
      rejectSubtype: null,
    },
  },
  {
    id: 'N01',
    name: 'たまに全公開',
    body: '誰かがAを出したら、しばらくの間だけ全員の手札を公開する。',
    expected: {
      verdict: 'needs_review',
      rejectCategory: null,
      rejectSubtype: null,
    },
  },
  {
    id: 'N02',
    name: '無限かもしれない交換',
    body: '4を出すたびに捨て札を何枚か手札へ戻す。戻す枚数は状況に合わせる。',
    expected: {
      verdict: 'needs_review',
      rejectCategory: null,
      rejectSubtype: null,
    },
  },
  {
    id: 'N03',
    name: 'フラッシュ出し',
    body: '同じマークならバラバラの数字でも5枚まとめて出せる。',
    expected: {
      verdict: 'needs_review',
      rejectCategory: null,
      rejectSubtype: null,
    },
  },
  {
    id: 'N04',
    name: '10捨て',
    body: '10を出した枚数分好きな自分の手持ちのカードを場に関係ないところに捨てることができる。捨てないことはできない。',
    expected: {
      verdict: 'approve',
      rejectCategory: null,
      rejectSubtype: null,
    },
  },
  {
    id: 'N05',
    name: '2択',
    body: '2を1枚出すとAかBを選択するミニゲームが始まる。(出した人も参加し、時間内に選択しなければAを選んだことになる)\n4秒間の選択時間があり、ランダムでAを選んだ人かBを選んだ人が1点もらえて、3点を手に入れた人が現れると終了する。\n3点を手に入れた人は好きなカードを3枚捨てることができる。',
    expected: {
      verdict: 'needs_review',
      rejectCategory: null,
      rejectSubtype: null,
      extensionNeeded: true,
    },
  },
  {
    id: 'N06',
    name: '早押し',
    body: 'Kを1枚で出すと全員参加の早押しミニゲームが始まる。3秒以内に最初にボタンを押した人が手札を1枚捨てられる。',
    expected: {
      verdict: 'needs_review',
      rejectCategory: null,
      rejectSubtype: null,
      extensionNeeded: true,
    },
  },
  {
    id: 'P11',
    name: 'クイーン決戦',
    body: 'Qを2枚同時に出すと、全員参加のボムスロー15が始まる。勝った人は自分の手札から好きな1枚を選んで捨てられる。',
    expected: {
      verdict: 'approve',
      rejectCategory: null,
      rejectSubtype: null,
      extensionNeeded: false,
    },
  },
  {
    id: 'P12',
    name: '強化Jバック',
    body: 'Jをn枚出すと、nターン革命状態が続く',
    existingRules: [
      {
        name: 'イレブンバック',
        summary:
          'Jを含む手を出すと、その場が流れるまでカードの強さ順を一時的に反転する。',
      },
    ],
    // 発動時点をsetMemoryへ保存し、played / passedを数えれば現行契約で表現できる。
    // 継続期間が既存イレブンバックと異なるため、実質重複にも当たらない。
    expected: {
      verdict: 'approve',
      rejectCategory: null,
      rejectSubtype: null,
      extensionNeeded: false,
    },
  },
  {
    id: 'P13',
    name: 'ギロチン時計',
    body: '2戦目以降、前のゲームの大貧民が4〜12からNを選ぶ。そのゲームで全員通算N回目の通常パスをした人が大貧民になる。自動スキップは数えず、初戦は発動しない。',
    expected: {
      verdict: 'approve',
      rejectCategory: null,
      rejectSubtype: null,
      extensionNeeded: false,
    },
  },
] as const;
