import type { Card, CardRank, Play } from '@daifugo/core';
import { describe, expect, it } from 'vitest';

import { deriveCardHints } from './hints';

function card(id: string, rank: CardRank): Card & { kind: 'natural' } {
  return { kind: 'natural', id, suit: 'spade', rank };
}

function play(...cards: (Card & { kind: 'natural' })[]): Play {
  return {
    kind: cards.length === 1 ? 'single' : 'set',
    cards,
    count: cards.length,
    repRank: cards[0]!.rank,
  };
}

function hints(
  hand: readonly Card[],
  legalMoves: readonly Play[] | null,
  selectedIds: readonly string[] = [],
) {
  return Object.fromEntries(deriveCardHints(hand, legalMoves, selectedIds));
}

describe('TU-02: deriveCardHints', () => {
  const three = card('S03', '3');
  const four = card('S04', '4');
  const five = card('S05', '5');

  it('手番外では合法手を受け取らず、すべてplayableにする', () => {
    expect(hints([three, four], null)).toEqual({
      S03: 'playable',
      S04: 'playable',
    });
  });

  it('未選択では、いずれかの合法手に含まれるカードだけをplayableにする', () => {
    expect(hints([three, four, five], [play(three), play(five)])).toEqual({
      S03: 'playable',
      S04: 'dimmed',
      S05: 'playable',
    });
  });

  it('単騎しか出せない場面では、組札にしか使えないカードも沈める', () => {
    expect(hints([three, four, five], [play(four)])).toEqual({
      S03: 'dimmed',
      S04: 'playable',
      S05: 'dimmed',
    });
  });

  it('ペアの1枚を選ぶと、その選択を含むペアの相方だけを残す', () => {
    const heartEight = { ...card('H08', '8'), suit: 'heart' as const };
    const clubEight = { ...card('C08', '8'), suit: 'club' as const };
    const nine = card('S09', '9');
    const hand = [card('S08', '8'), heartEight, clubEight, nine];

    expect(
      hints(
        hand,
        [play(hand[0]!, heartEight), play(hand[0]!, clubEight), play(nine)],
        ['S08'],
      ),
    ).toEqual({
      S08: 'playable',
      H08: 'playable',
      C08: 'playable',
      S09: 'dimmed',
    });
  });

  it('3枚出しの途中では、選択中2枚を含む合法手の残りだけを残す', () => {
    const heartJack = { ...card('HJ', 'J'), suit: 'heart' as const };
    const clubJack = { ...card('CJ', 'J'), suit: 'club' as const };
    const diamondJack = {
      ...card('DJ', 'J'),
      suit: 'diamond' as const,
    };
    const queen = card('SQ', 'Q');
    const hand = [card('SJ', 'J'), heartJack, clubJack, diamondJack, queen];

    expect(
      hints(
        hand,
        [
          play(hand[0]!, heartJack, clubJack),
          play(hand[0]!, heartJack, diamondJack),
          play(queen),
        ],
        ['SJ', 'HJ'],
      ),
    ).toEqual({
      SJ: 'playable',
      HJ: 'playable',
      CJ: 'playable',
      DJ: 'playable',
      SQ: 'dimmed',
    });
  });

  it('選択がどの合法手にも属さないときは、選択中だけ解除可能にする', () => {
    expect(
      hints([three, four, five], [play(three), play(four)], ['S03', 'S05']),
    ).toEqual({
      S03: 'playable',
      S04: 'dimmed',
      S05: 'playable',
    });
  });

  it('合法手が0件ならすべてdimmedにする', () => {
    expect(hints([three, four], [])).toEqual({
      S03: 'dimmed',
      S04: 'dimmed',
    });
  });

  it('空手札では空Mapを返す', () => {
    expect(hints([], [])).toEqual({});
  });
});
