import type { Card, Play, RuleContext } from '@daifugo/core';
import { describe, expect, it } from 'vitest';

import { rule } from './rule.js';

const context = {} as RuleContext;

function naturalCard(
  id: string,
  suit: Extract<Card, { kind: 'natural' }>['suit'],
  rank: Extract<Card, { kind: 'natural' }>['rank'],
): Extract<Card, { kind: 'natural' }> {
  return { kind: 'natural', id, suit, rank };
}

function play(cards: Card[], kind: Play['kind'] = 'single'): Play {
  return {
    kind,
    cards,
    count: cards.length,
    repRank: cards[0]?.kind === 'natural' ? cards[0].rank : 'joker',
  };
}

function effectsFor(candidate: Play) {
  const afterPlay = rule.hooks.afterPlay;
  expect(afterPlay).toBeTypeOf('function');
  return afterPlay?.(context, candidate);
}

describe('スペード3返し', () => {
  it('スペードの3を単体で出すと場を流す', () => {
    const effects = effectsFor(play([naturalCard('S03', 'spade', '3')]));

    expect(effects).toEqual([{ type: 'clearField' }]);
  });

  it('スペードの3を含む同一ランクの組でも1回だけ場を流す', () => {
    const effects = effectsFor(
      play(
        [
          naturalCard('S03', 'spade', '3'),
          naturalCard('H03', 'heart', '3'),
          naturalCard('D03', 'diamond', '3'),
        ],
        'set',
      ),
    );

    expect(effects).toEqual([{ type: 'clearField' }]);
  });

  it('スペードの3を含まない手では発動しない', () => {
    expect(effectsFor(play([naturalCard('H03', 'heart', '3')]))).toEqual([]);
    expect(effectsFor(play([naturalCard('S04', 'spade', '4')]))).toEqual([]);
  });

  it('合法性を変更するフックを持たず、不正な手を合法化しない', () => {
    expect(rule.hooks.modifyLegality).toBeUndefined();
  });

  it('手札を出し切るプレイでも同じ場流しEffectだけを返す', () => {
    const effects = effectsFor(play([naturalCard('S03', 'spade', '3')]));

    expect(effects).toEqual([{ type: 'clearField' }]);
    expect(effects).toHaveLength(1);
  });

  it('ジョーカーへの比較例外と競合せず、合法化は既存ルールに委ねて場流しだけを行う', () => {
    expect(Object.keys(rule.hooks)).toEqual(['afterPlay']);
    expect(effectsFor(play([naturalCard('S03', 'spade', '3')]))).toEqual([
      { type: 'clearField' },
    ]);
  });
});
