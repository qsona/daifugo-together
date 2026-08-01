import {
  BASE_STRENGTH_ORDER,
  compareRanks,
  createDeck,
  generateCandidates,
  type Card,
  type CardRank,
  type NaturalCard,
  type Play,
  type RuleContext,
  type RuleModule,
  type StrengthOrder,
  type Suit,
} from '@daifugo/core';
import { describe, expect, it, vi } from 'vitest';

const { rule } = (await vi.importActual('./rule.js')) as { rule: RuleModule };
const deck = createDeck(rule.meta.engineFeatures);

const natural = (suit: Suit, rank: CardRank): NaturalCard => {
  const found = deck.find(
    (card): card is NaturalCard =>
      card.kind === 'natural' && card.suit === suit && card.rank === rank,
  );
  if (!found) throw new Error(`missing ${suit} ${rank}`);
  return found;
};

const joker = (index: 0 | 1): Card => {
  const found = deck.find(
    (card) => card.kind === 'joker' && card.index === index,
  );
  if (!found) throw new Error(`missing joker ${index}`);
  return found;
};

const play = (
  kind: Play['kind'],
  cards: Card[],
  repRank: Play['repRank'],
): Play => ({
  kind,
  cards,
  count: cards.length,
  repRank,
});

function context(actor: string, remaining: Card[]): RuleContext {
  return {
    game: {
      field: {
        current: {
          by: actor,
          play: play('single', [natural('spade', '3')], '3'),
        },
        passedSinceLastPlay: [],
      },
      players: [
        { id: actor, hand: remaining },
        { id: 'p2', hand: [natural('club', '3')] },
      ],
    },
  } as unknown as RuleContext;
}

describe('ジョーカー2枚・オールマイティ', () => {
  it('ジョーカー単体は通常時と革命中のどちらでも最強になる', () => {
    const revolution: StrengthOrder = {
      ranking: [...BASE_STRENGTH_ORDER.ranking].reverse(),
      revolution: true,
    };

    expect(compareRanks('joker', '2', BASE_STRENGTH_ORDER)).toBeGreaterThan(0);
    expect(compareRanks('joker', '3', revolution)).toBeGreaterThan(0);
  });

  it('ジョーカーを同一ランクのペア・3枚組・5枚以上の組へ代用できる', () => {
    const pair = generateCandidates(
      [natural('heart', '7'), joker(0)],
      rule.meta.engineFeatures,
    );
    const triple = generateCandidates(
      [natural('heart', '7'), natural('spade', '7'), joker(1)],
      rule.meta.engineFeatures,
    );
    const sixCardSet = generateCandidates(
      [
        natural('spade', '7'),
        natural('heart', '7'),
        natural('diamond', '7'),
        natural('club', '7'),
        joker(0),
        joker(1),
      ],
      rule.meta.engineFeatures,
    );

    expect(
      pair.some(
        (candidate) =>
          candidate.kind === 'set' &&
          candidate.count === 2 &&
          candidate.repRank === '7',
      ),
    ).toBe(true);
    expect(
      triple.some(
        (candidate) =>
          candidate.kind === 'set' &&
          candidate.count === 3 &&
          candidate.repRank === '7',
      ),
    ).toBe(true);
    expect(
      sixCardSet.some(
        (candidate) =>
          candidate.kind === 'set' &&
          candidate.count === 6 &&
          candidate.repRank === '7',
      ),
    ).toBe(true);
  });

  it('同一スートの連番の欠けをジョーカーで補って階段にできる', () => {
    const candidates = generateCandidates(
      [natural('heart', '4'), natural('heart', '5'), joker(0)],
      rule.meta.engineFeatures,
    );

    expect(
      candidates.some(
        (candidate) =>
          candidate.kind === 'sequence' &&
          candidate.count === 3 &&
          candidate.cards.some((card) => card.kind === 'joker'),
      ),
    ).toBe(true);
  });

  it('Jokerを含む5枚以上の階段にできる', () => {
    const candidates = generateCandidates(
      [
        natural('heart', '4'),
        natural('heart', '5'),
        natural('heart', '7'),
        natural('heart', '8'),
        joker(0),
      ],
      rule.meta.engineFeatures,
    );

    expect(
      candidates.some(
        (candidate) =>
          candidate.kind === 'sequence' &&
          candidate.count === 5 &&
          candidate.repRank === '8' &&
          candidate.cards.some((card) => card.kind === 'joker'),
      ),
    ).toBe(true);
  });

  it('ジョーカーを含む手でも手札が残れば順位を変更しない', () => {
    const played = play('set', [natural('heart', '7'), joker(0)], '7');

    expect(
      rule.hooks.afterPlay?.(context('p1', [natural('spade', '9')]), played),
    ).toEqual([]);
  });

  it('ジョーカー単体で出し切ると最下位にする', () => {
    const played = play('single', [joker(0)], 'joker');

    expect(rule.hooks.afterPlay?.(context('p1', []), played)).toEqual([
      { type: 'forceRank', player: 'p1', rank: 'lowest' },
    ]);
  });

  it('組や階段の一部のジョーカーで出し切っても最下位にする', () => {
    const setPlay = play('set', [natural('heart', '7'), joker(0)], '7');
    const sequencePlay = play(
      'sequence',
      [natural('heart', '4'), natural('heart', '5'), joker(1)],
      '6',
    );

    expect(rule.hooks.afterPlay?.(context('p1', []), setPlay)).toEqual([
      { type: 'forceRank', player: 'p1', rank: 'lowest' },
    ]);
    expect(rule.hooks.afterPlay?.(context('p1', []), sequencePlay)).toEqual([
      { type: 'forceRank', player: 'p1', rank: 'lowest' },
    ]);
  });

  it('ジョーカーを含まない手で出し切っても順位を変更しない', () => {
    const played = play('single', [natural('heart', '7')], '7');

    expect(rule.hooks.afterPlay?.(context('p1', []), played)).toEqual([]);
  });

  it('デッキに2枚のジョーカーを含め、どちらも代用に利用できる', () => {
    const jokers = deck.filter((card) => card.kind === 'joker');
    expect(deck).toHaveLength(54);
    expect(jokers.map((card) => card.index)).toEqual([0, 1]);

    for (const candidateJoker of jokers) {
      const candidates = generateCandidates(
        [natural('spade', '4'), natural('spade', '5'), candidateJoker],
        rule.meta.engineFeatures,
      );
      expect(
        candidates.some(
          (candidate) =>
            candidate.kind === 'sequence' &&
            candidate.cards.some((card) => card.id === candidateJoker.id),
        ),
      ).toBe(true);
    }
  });
});
