import {
  SUITS,
  type GameState,
  type GameStatusView,
  type Play,
  type PublicGameEvent,
  type RuleChainEntry,
  type Suit,
} from '@daifugo/core';

/*
 * フェーズ1の継続状態アダプタ。
 * ルール契約(rule.ts の語彙)を変えずに配信したいので、状態を持つコアルール3件だけを
 * サーバー側から読む。ルールIDの知識はこの表 1 箇所に閉じ込めてあるので、
 * フェーズ2でルール契約へ省略可能フック(presentStatus)が入ったら、
 * 表ごと「チェーンを回してルール自身に聞く」実装へ差し替えられる。
 */
const STATUS_RULE_IDS = {
  revolution: 'r0003-kakumei',
  elevenBack: 'r0005-eleven-back',
  binding: 'r0008-shibari-double-shibari',
} as const;

/** r0003 / r0005 が継続中フラグを書き込むゲームメモリのキー。 */
const ACTIVE_MEMORY_KEY = 'active';

type SuitCounts = [number, number, number, number];

function isMemoryActive(state: GameState, ruleId: string): boolean {
  return state.private.memory[ruleId]?.[ACTIVE_MEMORY_KEY] === true;
}

function naturalSuitCounts(play: Play): SuitCounts {
  const counts: SuitCounts = [0, 0, 0, 0];
  for (const card of play.cards) {
    if (card.kind === 'natural') {
      const index = SUITS.indexOf(card.suit);
      counts[index] = (counts[index] ?? 0) + 1;
    }
  }
  return counts;
}

function signature(counts: SuitCounts): string {
  return counts.join(',');
}

function containsJoker(play: Play): boolean {
  return play.cards.some((card) => card.kind === 'joker');
}

function suitsFromCounts(counts: SuitCounts): Suit[] {
  return SUITS.flatMap((suit, index) =>
    Array.from({ length: counts[index] ?? 0 }, () => suit),
  );
}

/*
 * r0008 の bindingFromHistory と同じ意味論をサーバー側で再実装したもの。
 * packages/rules は変更しない(rule-versions の繰り上げを避ける)方針なので、
 * 表示用の導出だけをここへ写している。r0008 側を触るときは必ず両方を揃えること。
 */
function bindingSuits(history: readonly PublicGameEvent[]): Suit[] | null {
  let previous: string | null = null;
  let binding: SuitCounts | null = null;

  for (const event of history) {
    if (event.type === 'fieldCleared') {
      previous = null;
      binding = null;
      continue;
    }
    if (event.type !== 'played') continue;
    if (containsJoker(event.play)) {
      previous = null;
      continue;
    }

    const counts = naturalSuitCounts(event.play);
    const current = signature(counts);
    if (binding === null && previous === current) {
      binding = counts;
    }
    previous = current;
  }

  return binding === null ? null : suitsFromCounts(binding);
}

const SCOPE_ORDER: Record<GameStatusView['scope'], number> = {
  game: 0,
  field: 1,
};

/**
 * いま継続している状態を、局面(ルールメモリと履歴)から毎回算出する。
 * イベント列の再生に頼らないので、再接続や途中参加でも同じ結果になる。
 */
export function gameStatusViews(
  state: GameState,
  ruleChain: readonly RuleChainEntry[],
): GameStatusView[] {
  const found: { view: GameStatusView; position: number }[] = [];

  ruleChain.forEach((entry, position) => {
    const base = { ruleId: entry.ruleId, name: entry.name };
    if (
      entry.ruleId === STATUS_RULE_IDS.revolution &&
      isMemoryActive(state, entry.ruleId)
    ) {
      found.push({ view: { ...base, scope: 'game' }, position });
      return;
    }
    if (
      entry.ruleId === STATUS_RULE_IDS.elevenBack &&
      isMemoryActive(state, entry.ruleId)
    ) {
      found.push({ view: { ...base, scope: 'field' }, position });
      return;
    }
    if (entry.ruleId === STATUS_RULE_IDS.binding) {
      const suits = bindingSuits(state.public.history);
      if (suits !== null) {
        found.push({ view: { ...base, scope: 'field', suits }, position });
      }
    }
  });

  return found
    .sort(
      (left, right) =>
        SCOPE_ORDER[left.view.scope] - SCOPE_ORDER[right.view.scope] ||
        left.position - right.position,
    )
    .map((entry) => entry.view);
}
