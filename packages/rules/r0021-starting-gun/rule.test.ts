import {
  BASE_STRENGTH_ORDER,
  createInProcessRuleChainPort,
  enumerateLegalPlays,
  startGame,
  type Card,
  type Play,
  type PublicGameEvent,
  type RuleChainEntry,
  type RuleContext,
  type RuleModule,
  type RuleRuntime,
} from '@daifugo/core';
import { describe, expect, it, vi } from 'vitest';

const { rule } = (await vi.importActual('./rule.js')) as { rule: RuleModule };

const card = (id: string, rank: '3' | '4' | '5'): Card => ({
  kind: 'natural',
  id,
  suit: id.startsWith('D') ? 'diamond' : 'spade',
  rank,
});

function play(kind: Play['kind'], ...cards: Card[]): Play {
  return {
    kind,
    cards,
    count: cards.length,
    repRank:
      cards.find((candidate) => candidate.kind === 'natural')?.rank ?? 'joker',
  };
}

const played = (value: Play): PublicGameEvent => ({
  type: 'played',
  player: 'p1',
  play: value,
});

function context(history: PublicGameEvent[] = []): RuleContext {
  return {
    contractVersion: 1,
    game: {
      gameIndex: 0,
      seats: ['p1', 'p2', 'p3', 'p4'],
      direction: 1,
      turn: 'p1',
      players: [],
      field: { passedSinceLastPlay: [] },
      discard: [],
      history,
      strength: BASE_STRENGTH_ORDER,
    },
    setHistory: [],
    memory: { game: {}, set: {} },
    rng: { next: () => 0.5, int: () => 0 },
  } as RuleContext;
}

const entry: RuleChainEntry = {
  ruleId: rule.meta.ruleId,
  name: rule.meta.name,
  position: 0,
  priority: { score: 0, activatedAt: 0, ruleId: rule.meta.ruleId },
  bundleHash: 'starting-gun-test',
  contractVersion: 1,
};

const runtime: RuleRuntime = {
  port: createInProcessRuleChainPort([rule]),
  setHistory: [],
  setMemory: {},
};

describe('号砲', () => {
  it('meta.jsonと同じメタデータを公開する', () => {
    expect(rule.meta).toEqual({
      ruleId: 'r0021-starting-gun',
      name: '号砲',
      description:
        'ゲーム開始時はダイヤの3を持つプレイヤーが先手となり、そのゲームの最初の手にはダイヤの3を必ず含めなければならない。',
      kind: 'local',
      prefecture: '東京都',
      proposalId: '01KZ1FQBX1DY3EBGAWYXRKKRF1',
      contractVersion: 1,
      messages: {},
    });
  });

  it('最初の手はダイヤの3を含む場合だけ合法とする', () => {
    expect(
      rule.hooks.modifyLegality?.(
        context([{ type: 'gameStarted', firstPlayer: 'p1', handCounts: {} }]),
        play('single', card('D03', '3')),
        { legal: true },
      ),
    ).toEqual({ legal: true });
    expect(
      rule.hooks.modifyLegality?.(
        context([{ type: 'gameStarted', firstPlayer: 'p1', handCounts: {} }]),
        play('single', card('S04', '4')),
        { legal: true },
      ),
    ).toEqual({ legal: false });
  });

  it('ダイヤの3を含む合法な組や階段も許可する', () => {
    const diamondThree = card('D03', '3');
    expect(
      rule.hooks.modifyLegality?.(
        context(),
        play('set', diamondThree, card('S03', '3')),
        { legal: true },
      ),
    ).toEqual({ legal: true });
    expect(
      rule.hooks.modifyLegality?.(
        context(),
        play('sequence', diamondThree, card('D04', '4'), card('D05', '5')),
        { legal: true },
      ),
    ).toEqual({ legal: true });
  });

  it('通常ルールで不合法な手はダイヤの3を含んでも合法化しない', () => {
    const base = { legal: false as const, reasonKey: 'INVALID_PLAY' };
    expect(
      rule.hooks.modifyLegality?.(
        context(),
        play('single', card('D03', '3')),
        base,
      ),
    ).toEqual(base);
  });

  it('最初のプレイ後は場が流れても制約を再適用しない', () => {
    const first = play('single', card('D03', '3'));
    const later = play('single', card('S04', '4'));
    const history: PublicGameEvent[] = [
      played(first),
      { type: 'fieldCleared', reason: 'allPassed', nextLeader: 'p1' },
    ];
    expect(
      rule.hooks.modifyLegality?.(context(history), later, { legal: true }),
    ).toEqual({ legal: true });
  });

  it('エンジンはダイヤの3の所持者を先手にし、最初の合法手を同カード含みに限定する', () => {
    const config = {
      gameIndex: 0,
      seats: ['p1', 'p2', 'p3', 'p4'],
      gameSeed: 'starting-gun-integration',
      ruleChain: [entry],
    };
    const started = startGame(config, runtime);
    const firstPlayer = started.state.public.turn;
    expect(firstPlayer).not.toBeNull();
    expect(
      started.state.players[firstPlayer ?? '']?.hand.some(
        (candidate) => candidate.id === 'D03',
      ),
    ).toBe(true);
    expect(
      enumerateLegalPlays(config, started.state, firstPlayer ?? '', runtime),
    ).toSatisfy((plays: Play[]) =>
      plays.every((candidate) =>
        candidate.cards.some((candidateCard) => candidateCard.id === 'D03'),
      ),
    );
  });
});
