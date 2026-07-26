/**
 * DS-02 の画面はすべて表示専用(presentational)で、データは props で受ける。
 * ここはトーン確認と受け入れ検証のための固定データで、
 * GE-02 / MP-01 が実装されたら本物のスナップショットに差し替える(E04 §3.2 の責務分担)。
 */

import type { CardView } from '../components/Card';
import type { LogEntry } from '../components/Log';
import type { MemberView } from '../components/MemberList';
import type { SeatView } from '../components/PlayerSeat';
import type { RankView } from '../components/RankRow';
import type { FiredRuleVote } from '../screens/SetResultScreen';

export const DEMO_MEMBERS: readonly MemberView[] = [
  { kind: 'human', name: 'あなた', role: 'ホスト' },
  { kind: 'human', name: 'プレイヤーB' },
  { kind: 'empty' },
  { kind: 'empty' },
];

export const DEMO_INVITE_CODE = 'ABCD-1234';
export const DEMO_ACTIVE_RULE_COUNT = 31;

export const DEMO_SEATS: readonly SeatView[] = [
  {
    name: 'プレイヤーB',
    kind: 'ai',
    handCount: 8,
    isCurrentTurn: false,
    hasPassed: false,
  },
  {
    name: 'プレイヤーC',
    kind: 'human',
    handCount: 6,
    isCurrentTurn: true,
    hasPassed: false,
  },
  {
    name: 'プレイヤーD',
    kind: 'ai',
    handCount: 11,
    isCurrentTurn: false,
    hasPassed: true,
  },
];

export const DEMO_FIELD: readonly CardView[] = [
  { id: 'field-d8', suit: 'diamond', rank: '8' },
];

export const DEMO_LOG: readonly LogEntry[] = [
  { id: 'l1', kind: 'play', text: 'プレイヤーB: ♠5 ♥5 を出した' },
  { id: 'l2', kind: 'play', text: 'プレイヤーC: ♦8 を出した' },
  { id: 'l3', kind: 'ruleFired', text: 'ルール発動「8切り」 場が流れた' },
  { id: 'l4', kind: 'play', text: 'あなたの番です' },
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

export const DEMO_GAME_RANKS: readonly RankView[] = [
  { place: 1, name: 'あなた', kind: 'human', title: '大富豪' },
  { place: 2, name: 'プレイヤーB', kind: 'ai', title: '富豪' },
  { place: 3, name: 'プレイヤーC', kind: 'human', title: '貧民' },
  { place: 4, name: 'プレイヤーD', kind: 'ai', title: '大貧民' },
];

export const DEMO_SET_RANKS: readonly RankView[] = [
  { place: 1, name: 'あなた', kind: 'human', title: '大富豪' },
  { place: 2, name: 'プレイヤーB', kind: 'ai', title: '富豪' },
  { place: 3, name: 'プレイヤーC', kind: 'human', title: '貧民' },
  { place: 4, name: 'プレイヤーD', kind: 'ai', title: '大貧民' },
];

export const DEMO_FIRED_RULES: readonly FiredRuleVote[] = [
  { ruleId: 'r-8giri', name: '8切り', vote: null },
  { ruleId: 'r-kakumei', name: '革命返し', vote: null },
  { ruleId: 'r-miyakoochi', name: '都落ち', vote: null },
];
