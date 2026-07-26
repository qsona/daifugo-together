/**
 * DS-02 の画面はすべて表示専用(presentational)で、データは props で受ける。
 * ここはトーン確認と受け入れ検証のための固定データで、
 * GE-02 / MP-01 が実装されたら本物のスナップショットに差し替える(E04 §3.2 の責務分担)。
 */

import type { CardView } from '../components/Card';
import type { MemberView } from '../components/MemberList';
import type { RankView } from '../components/RankRow';
import type { RuleActivation } from '../components/RuleCutIn';
import type { TableSeat } from '../components/Table';
import type { FiredRuleVote } from '../screens/SetResultScreen';

export const DEMO_MEMBERS: readonly MemberView[] = [
  { kind: 'human', name: 'あなた', role: 'ホスト' },
  { kind: 'human', name: 'プレイヤーB' },
  { kind: 'empty' },
  { kind: 'empty' },
];

export const DEMO_INVITE_CODE = 'ABCD-1234';
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
    name: 'プレイヤーB',
    isSelf: false,
    handCount: 8,
    isCurrentTurn: false,
    hasPassed: false,
    plays: [
      [
        { id: 'f-s5', suit: 'spade', rank: '5' },
        { id: 'f-h5', suit: 'heart', rank: '5' },
      ],
    ],
  },
  {
    name: 'プレイヤーC',
    isSelf: false,
    handCount: 6,
    isCurrentTurn: true,
    hasPassed: false,
    plays: [[{ id: 'f-d8', suit: 'diamond', rank: '8' }]],
  },
  {
    name: 'プレイヤーD',
    isSelf: false,
    handCount: 11,
    isCurrentTurn: false,
    hasPassed: true,
    plays: [],
  },
];

export const DEMO_LEAD_SEAT = 'プレイヤーC';

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

export const DEMO_GAME_RANKS: readonly RankView[] = [
  { place: 1, name: 'あなた', kind: 'human', title: '大富豪' },
  { place: 2, name: 'プレイヤーB', kind: 'ai', title: '富豪' },
  { place: 3, name: 'プレイヤーC', kind: 'human', title: '貧民' },
  { place: 4, name: 'プレイヤーD', kind: 'ai', title: '大貧民' },
];

/** セットリザルトは 3 戦の推移込み。「総合結果である」ことをデータ自身が語る。 */
export const DEMO_SET_RANKS: readonly RankView[] = [
  {
    place: 1,
    name: 'あなた',
    kind: 'human',
    title: '大富豪',
    history: [1, 1, 2],
  },
  {
    place: 2,
    name: 'プレイヤーB',
    kind: 'ai',
    title: '富豪',
    history: [2, 3, 1],
  },
  {
    place: 3,
    name: 'プレイヤーC',
    kind: 'human',
    title: '貧民',
    history: [3, 2, 3],
  },
  {
    place: 4,
    name: 'プレイヤーD',
    kind: 'ai',
    title: '大貧民',
    history: [4, 4, 4],
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

export const DEMO_FIRED_RULES: readonly FiredRuleVote[] = [
  { ruleId: 'r-8giri', name: '8切り', vote: null },
  { ruleId: 'r-kakumei', name: '革命返し', vote: null },
  { ruleId: 'r-miyakoochi', name: '都落ち', vote: null },
];
