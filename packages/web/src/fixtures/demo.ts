/**
 * DS-02 の画面はすべて表示専用(presentational)で、データは props で受ける。
 * ここはトーン確認と受け入れ検証のための固定データで、
 * GE-02 / MP-01 が実装されたら本物のスナップショットに差し替える(E04 §3.2 の責務分担)。
 */

import type { CardView } from '../components/Card';
import type { MemberView } from '../components/MemberList';
import type { GameRankView } from '../components/GameRankRows';
import type { SetRankView } from '../components/SetRankRows';
import type { RuleActivation } from '../components/RuleCutIn';
import type { GameStatusMarker } from '../components/StateMarkers';
import type { TableSeat } from '../components/Table';
import type { SeatFinish } from '../screens/GameScreen';
import type { FiredRuleVote } from '../screens/SetResultScreen';

export const DEMO_MEMBERS: readonly MemberView[] = [
  { kind: 'human', name: 'あなた', role: 'ホスト' },
  { kind: 'human', name: 'プレイヤーB' },
  { kind: 'empty' },
  { kind: 'empty' },
];

export const DEMO_INVITE_CODE = '01234';
export const DEMO_ACTIVE_RULE_COUNT = 31;

/**
 * 卓。自分を先頭に、手番が回る順(時計回り)で 4 人。
 * 各席が「席の情報」と「その人がこの場に出した札」の両方を持つ。
 */
export const DEMO_SEATS: readonly TableSeat[] = [
  {
    name: 'あなた',
    isSelf: true,
    handCount: 10,
    isCurrentTurn: false,
    hasPassed: false,
    plays: [],
  },
  {
    // あがった席の見本。残り枚数ではなく順位バッジを出し、席は減光する。
    name: 'プレイヤーB',
    isSelf: false,
    handCount: 0,
    isCurrentTurn: false,
    hasPassed: false,
    kind: 'ai',
    finishedRank: 1,
    finishedTitle: '大富豪',
    plays: [
      // 同じ場で 2 回出した席の見本。場に出るのは最新の 1 回(9 のペア)だけ。
      [
        { id: 'f-s5', suit: 'spade', rank: '5' },
        { id: 'f-h5', suit: 'heart', rank: '5' },
      ],
      [
        { id: 'f-s9', suit: 'spade', rank: '9' },
        { id: 'f-h9', suit: 'heart', rank: '9' },
      ],
    ],
  },
  {
    name: 'プレイヤーC',
    isSelf: false,
    handCount: 6,
    isCurrentTurn: true,
    hasPassed: false,
    status: '考え中…',
    plays: [[{ id: 'f-d8', suit: 'diamond', rank: '8' }]],
  },
  {
    name: 'プレイヤーD',
    isSelf: false,
    handCount: 11,
    isCurrentTurn: false,
    hasPassed: true,
    kind: 'ai',
    plays: [],
  },
];

export const DEMO_LEAD_SEAT = 'プレイヤーC';

/**
 * 卓の見本に合わせたあがりの履歴。
 * 初回描画時点の分は告知しないので、見本を開いた瞬間に告知は出ない
 * (再接続で全量スナップショットが届いたときと同じ振る舞い)。
 */
export const DEMO_SEAT_FINISHES: readonly SeatFinish[] = [
  { seat: 1, name: 'プレイヤーB', isSelf: false, rank: 1, title: '大富豪' },
];

export const DEMO_HAND: readonly CardView[] = [
  { id: 'h-c3', suit: 'club', rank: '3' },
  { id: 'h-d4', suit: 'diamond', rank: '4' },
  { id: 'h-s6', suit: 'spade', rank: '6' },
  { id: 'h-h7', suit: 'heart', rank: '7' },
  { id: 'h-h9', suit: 'heart', rank: '9' },
  { id: 'h-s10', suit: 'spade', rank: '10' },
  { id: 'h-dj', suit: 'diamond', rank: 'J' },
  { id: 'h-cq', suit: 'club', rank: 'Q' },
  { id: 'h-sk', suit: 'spade', rank: 'K' },
  { id: 'h-h2', suit: 'heart', rank: '2' },
];

/** 見本は最終戦(第 3 戦)の直後。この戦の得点とセット累計が別々に出る。 */
export const DEMO_GAME_RANKS: readonly GameRankView[] = [
  {
    place: 1,
    name: 'あなた',
    kind: 'human',
    title: '大富豪',
    gainedPoints: 5,
    totalPoints: 13,
  },
  {
    place: 2,
    name: 'プレイヤーB',
    kind: 'ai',
    title: '富豪',
    gainedPoints: 3,
    totalPoints: 10,
  },
  {
    place: 3,
    name: 'プレイヤーC',
    kind: 'human',
    title: '貧民',
    gainedPoints: 2,
    totalPoints: 7,
  },
  {
    place: 4,
    name: 'プレイヤーD',
    kind: 'ai',
    title: '大貧民',
    gainedPoints: 1,
    totalPoints: 3,
  },
];

/** セットリザルトは 3 戦の合計点だけ。各戦の内訳は最終戦リザルトが見せている。 */
export const DEMO_SET_RANKS: readonly SetRankView[] = [
  {
    place: 1,
    name: 'あなた',
    kind: 'human',
    title: '大富豪',
    totalPoints: 13,
    isYou: true,
  },
  {
    place: 2,
    name: 'プレイヤーB',
    kind: 'ai',
    title: '富豪',
    totalPoints: 10,
  },
  {
    place: 3,
    name: 'プレイヤーC',
    kind: 'human',
    title: '貧民',
    totalPoints: 7,
  },
  {
    place: 4,
    name: 'プレイヤーD',
    kind: 'ai',
    title: '大貧民',
    totalPoints: 3,
  },
];

/**
 * カットインの見本。プレイのたびに順に再生して、
 * 単発 / 初登場 / 同時発動の 3 パターンを確認できるようにしてある。
 */
export const DEMO_ACTIVATION_VOLLEYS: readonly (readonly RuleActivation[])[] = [
  [{ ruleId: 'r-8giri', name: '8切り', isFirstSeen: false }],
  [
    {
      ruleId: 'r-shinkansen',
      name: '新幹線',
      effectLabel: '次の人を飛ばす',
      isFirstSeen: true,
    },
  ],
  [
    { ruleId: 'r-kakumei', name: '革命返し', isFirstSeen: false },
    { ruleId: 'r-spe3', name: 'スペ3返し', isFirstSeen: false },
    { ruleId: 'r-miyakoochi', name: '都落ち', isFirstSeen: true },
  ],
];

/**
 * 継続状態の見本。革命(局スコープ)と ♠ 縛り(場スコープ)が同時に生きた状態で、
 * 局リボン・場チップ・反転した強さ目盛りをまとめて目視できる。
 */
export const DEMO_GAME_STATUSES: readonly GameStatusMarker[] = [
  { ruleId: 'r-kakumei', name: '革命', scope: 'game' },
  { ruleId: 'r-shibari', name: 'しばり', scope: 'field', suits: ['spade'] },
];

export const DEMO_FIRED_RULES: readonly FiredRuleVote[] = [
  { ruleId: 'r-8giri', name: '8切り', vote: null },
  { ruleId: 'r-kakumei', name: '革命返し', vote: null },
  { ruleId: 'r-miyakoochi', name: '都落ち', vote: null },
];
