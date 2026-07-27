import type { PlayerRoomView } from '@daifugo/core';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import type { CardView } from './components/Card';
import type { MemberView as MemberListView } from './components/MemberList';
import type { RankView } from './components/RankRow';
import type { TableSeat } from './components/Table';
import type { SeatFinish } from './screens/GameScreen';
import type { RuleVote, SetFunRating } from './screens/SetResultScreen';
import {
  DEMO_ACTIVATION_VOLLEYS,
  DEMO_ACTIVE_RULE_COUNT,
  DEMO_FIRED_RULES,
  DEMO_GAME_RANKS,
  DEMO_HAND,
  DEMO_INVITE_CODE,
  DEMO_LEAD_SEAT,
  DEMO_MEMBERS,
  DEMO_SEATS,
  DEMO_SEAT_FINISHES,
  DEMO_SET_RANKS,
} from './fixtures/demo';
import { GameResultScreen } from './screens/GameResultScreen';
import { GameScreen } from './screens/GameScreen';
import { MenuScreen } from './screens/MenuScreen';
import { MyProposalsScreen } from './screens/MyProposalsScreen';
import {
  getBrowserMultiplayerClient,
  type MultiplayerClient,
} from './multiplayer/client';
import { ConnectionStatus } from './multiplayer/ConnectionStatus';
import { PlaySheet } from './screens/PlaySheet';
import { getBrowserProposalClient, type ProposalApi } from './proposal/client';
import { ProposalFormScreen } from './screens/ProposalFormScreen';
import { SetResultScreen } from './screens/SetResultScreen';
import { TitleScreen } from './screens/TitleScreen';
import { WaitingRoomScreen } from './screens/WaitingRoomScreen';
import { useScreenStore } from './store/screen';

const DEMO_PROPOSAL_API: ProposalApi = {
  submit: async (request) => ({
    outcome: 'accepted',
    proposal: {
      id: 'demo-proposal',
      kind: request.kind,
      prefectureCode:
        request.kind === 'local' &&
        typeof request.prefectureCode === 'string' &&
        request.prefectureCode.length > 0
          ? (request.prefectureCode as '11')
          : null,
      prefectureName:
        request.kind === 'local' && request.prefectureCode === '11'
          ? '埼玉県'
          : null,
      name: request.name,
      body: request.body,
      status: 'screening',
      reason: null,
      releasedRuleId: null,
      popularity: null,
      priorityRank: null,
      unread: true,
      createdAt: Date.now(),
      statusChangedAt: Date.now(),
    },
  }),
  mine: async () => ({ items: [], unreadCount: 0 }),
  markProposalsSeen: async () => undefined,
};

/**
 * フェーズ 1 の画面の組み立て。
 * 各画面は表示専用で、ここが渡しているのは固定データ(`fixtures/demo`)。
 * サーバースナップショットの接続と合法手の判定は E1/E3 の責務。
 */
function DemoApp() {
  const current = useScreenStore((state) => state.current);
  const go = useScreenStore((state) => state.go);

  const [selectedCardIds, setSelectedCardIds] = useState<readonly string[]>([]);
  const [funRating, setFunRating] = useState<SetFunRating | null>(null);
  const [ruleVotes, setRuleVotes] = useState(DEMO_FIRED_RULES);
  /** 見本のカットインを順に再生するための位置。null は再生していない状態。 */
  const [isChoosingRoom, setIsChoosingRoom] = useState(false);
  const [volleyIndex, setVolleyIndex] = useState<number | null>(null);
  const [lastVolleyIndex, setLastVolleyIndex] = useState<number | null>(null);

  const activations =
    volleyIndex === null ? [] : (DEMO_ACTIVATION_VOLLEYS[volleyIndex] ?? []);
  const lastVolley =
    lastVolleyIndex === null
      ? null
      : (DEMO_ACTIVATION_VOLLEYS[lastVolleyIndex] ?? null);

  const playNextVolley = () => {
    const next =
      lastVolleyIndex === null
        ? 0
        : (lastVolleyIndex + 1) % DEMO_ACTIVATION_VOLLEYS.length;
    setVolleyIndex(next);
    setLastVolleyIndex(next);
  };

  const finishCutIn = useCallback(() => {
    setVolleyIndex(null);
  }, []);

  const toggleCard = (id: string) => {
    setSelectedCardIds((ids) =>
      ids.includes(id) ? ids.filter((it) => it !== id) : [...ids, id],
    );
  };

  const voteRule = (ruleId: string, vote: RuleVote) => {
    setRuleVotes((rules) =>
      rules.map((rule) => (rule.ruleId === ruleId ? { ...rule, vote } : rule)),
    );
  };

  switch (current) {
    case 'title':
      return (
        <TitleScreen
          onStart={() => {
            go('menu');
          }}
        />
      );

    case 'menu':
      return (
        <>
          <MenuScreen
            onPlay={() => {
              setIsChoosingRoom(true);
            }}
            onPropose={() => go('proposal')}
            onEncyclopedia={() => undefined}
            onMyProposals={() => go('myProposals')}
            onHowToPlay={() => undefined}
          />
          {isChoosingRoom && (
            <PlaySheet
              onCreate={() => {
                setIsChoosingRoom(false);
                go('waitingRoom');
              }}
              onJoin={() => {
                setIsChoosingRoom(false);
                go('waitingRoom');
              }}
              onClose={() => {
                setIsChoosingRoom(false);
              }}
            />
          )}
        </>
      );

    case 'proposal':
      return (
        <ProposalFormScreen api={DEMO_PROPOSAL_API} onBack={() => go('menu')} />
      );

    case 'myProposals':
      return (
        <MyProposalsScreen api={DEMO_PROPOSAL_API} onBack={() => go('menu')} />
      );

    case 'waitingRoom':
      return (
        <WaitingRoomScreen
          members={DEMO_MEMBERS}
          inviteCode={DEMO_INVITE_CODE}
          activeRuleCount={DEMO_ACTIVE_RULE_COUNT}
          onBack={() => {
            go('menu');
          }}
          onCopyInvite={() => undefined}
          onViewRules={() => undefined}
          onStart={() => {
            go('game');
          }}
        />
      );

    case 'game':
      return (
        <GameScreen
          gameLabel="第1戦"
          activeRuleCount={DEMO_ACTIVE_RULE_COUNT}
          seats={DEMO_SEATS}
          finishes={DEMO_SEAT_FINISHES}
          leadSeatName={DEMO_LEAD_SEAT}
          activations={activations}
          onCutInDone={finishCutIn}
          lastActivation={
            lastVolley && lastVolley[0]
              ? { name: lastVolley[0].name, count: lastVolley.length }
              : null
          }
          hand={DEMO_HAND}
          selectedCardIds={selectedCardIds}
          isMyTurn
          onViewRules={() => undefined}
          onToggleCard={toggleCard}
          onPlay={() => {
            setSelectedCardIds([]);
            // 見本のため、カードを出すたびにカットインの 3 パターンを順に再生する。
            playNextVolley();
          }}
          onPass={() => {
            go('gameResult');
          }}
        />
      );

    case 'gameResult':
      return (
        <GameResultScreen
          title="第1戦 おわり"
          progressLabel="セット 1 / 3 戦"
          ranks={DEMO_GAME_RANKS}
          nextLabel="第2戦へ"
          autoAdvanceMs={15_000}
          autoAdvanceAt={Date.now() + 15_000}
          onNext={() => {
            go('setResult');
          }}
        />
      );

    case 'setResult':
      return (
        <SetResultScreen
          ranks={DEMO_SET_RANKS}
          funRating={funRating}
          firedRules={ruleVotes}
          onChangeFunRating={setFunRating}
          onVoteRule={voteRule}
          onPlayAgain={() => {
            go('game');
          }}
          onHome={() => {
            go('menu');
          }}
        />
      );
  }
}

function cards(
  cards: PlayerRoomView['game'] extends null
    ? never
    : NonNullable<PlayerRoomView['game']>['yourHand'],
): CardView[] {
  return cards.map((card) => ({
    id: card.id,
    suit: card.suit,
    rank: card.rank,
  }));
}

function waitingMembers(room: PlayerRoomView): MemberListView[] {
  const members: MemberListView[] = room.members.map((member) =>
    member.isAI
      ? { kind: 'ai', name: member.displayName }
      : {
          kind: 'human',
          name:
            member.memberId === room.you.memberId
              ? 'あなた'
              : member.displayName,
          ...(member.isHost ? { role: 'ホスト' } : {}),
          ...(!member.connected ? { status: '切断中' } : {}),
        },
  );
  while (members.length < 4) members.push({ kind: 'empty' });
  return members;
}

/**
 * この戦であがった人を、あがった順に。
 * 履歴は戦ごとなので、`gameStarted` が来たら積み直す。
 */
function seatFinishes(room: PlayerRoomView): SeatFinish[] {
  const game = room.game;
  if (!game) return [];
  const bySeat = new Map(
    room.members.flatMap((member) =>
      member.seatId === null ? [] : ([[member.seatId, member]] as const),
    ),
  );
  let finishes: SeatFinish[] = [];
  for (const event of game.history) {
    if (event.t === 'gameStarted') {
      finishes = [];
    } else if (event.t === 'playerFinished') {
      const member = bySeat.get(event.seat);
      finishes.push({
        seat: event.seat,
        name:
          member?.memberId === room.you.memberId
            ? 'あなた'
            : (member?.displayName ?? `席${String(event.seat + 1)}`),
        isSelf: member?.memberId === room.you.memberId,
        rank: event.rank,
        title: event.title,
      });
    }
  }
  return finishes;
}

function tableSeats(room: PlayerRoomView): TableSeat[] {
  const game = room.game;
  if (!game || room.you.seatId === null) return [];
  const plays = new Map<number, CardView[][]>();
  for (const event of game.history) {
    if (event.t === 'gameStarted' || event.t === 'fieldCleared') {
      plays.clear();
    } else if (event.t === 'played') {
      plays.set(event.seat, [
        ...(plays.get(event.seat) ?? []),
        cards(event.cards),
      ]);
    }
  }
  const finished = new Map(
    seatFinishes(room).map((finish) => [finish.seat, finish] as const),
  );
  const bySeat = new Map(
    room.members.flatMap((member) =>
      member.seatId === null ? [] : ([[member.seatId, member]] as const),
    ),
  );
  return [0, 1, 2, 3].map((offset) => {
    const seat = ((room.you.seatId! + offset) % 4) as 0 | 1 | 2 | 3;
    const member = bySeat.get(seat);
    const finish = finished.get(seat);
    const status = member?.isAI
      ? game.turn?.seat === seat
        ? '考え中…'
        : undefined
      : member?.departed
        ? '退出(AI代行)'
        : !member?.connected || member.aiActing
          ? '切断中(AI代行)'
          : undefined;
    return {
      name:
        member?.memberId === room.you.memberId
          ? 'あなた'
          : (member?.displayName ?? `席${String(seat + 1)}`),
      isSelf: member?.memberId === room.you.memberId,
      handCount: member?.handCount ?? 0,
      isCurrentTurn: game.turn?.seat === seat,
      hasPassed: game.field.passedSeats.includes(seat),
      kind: member?.isAI ? 'ai' : 'human',
      ...(status ? { status } : {}),
      // 履歴に playerFinished が無くても、スナップショットの順位だけは拾う。
      finishedRank: finish?.rank ?? member?.finishedRank ?? null,
      ...(finish ? { finishedTitle: finish.title } : {}),
      plays: plays.get(seat) ?? [],
    };
  });
}

function gameRanks(room: PlayerRoomView): RankView[] {
  const results = room.game?.previousResults ?? [];
  const result = results.at(-1);
  if (!result) return [];
  // 累計点はこの戦までの全戦から積む(各戦の点はサーバーが順位点で埋めている)。
  const cumulative = new Map<number, number>();
  for (const previous of results) {
    for (const standing of previous.standings) {
      cumulative.set(
        standing.seat,
        (cumulative.get(standing.seat) ?? 0) + standing.points,
      );
    }
  }
  const bySeat = new Map(
    room.members.flatMap((member) =>
      member.seatId === null ? [] : ([[member.seatId, member]] as const),
    ),
  );
  return [...result.standings]
    .sort((left, right) => left.rank - right.rank)
    .map((standing) => {
      const member = bySeat.get(standing.seat);
      return {
        place: standing.rank,
        name:
          member?.memberId === room.you.memberId
            ? 'あなた'
            : (member?.displayName ?? `席${String(standing.seat + 1)}`),
        kind: member?.isAI ? ('ai' as const) : ('human' as const),
        title: standing.title,
        gainedPoints: standing.points,
        totalPoints: cumulative.get(standing.seat) ?? standing.points,
      };
    });
}

function setRanks(room: PlayerRoomView): RankView[] {
  const standings = room.setResult?.standings ?? [];
  return [...standings]
    .sort((left, right) => left.totalRank - right.totalRank)
    .map((standing, index) => {
      const member = room.members.find(
        (candidate) => candidate.memberId === standing.memberId,
      );
      return {
        place: index + 1,
        name:
          standing.memberId === room.you.memberId
            ? 'あなた'
            : (member?.displayName ?? 'プレイヤー'),
        kind: member?.isAI ? ('ai' as const) : ('human' as const),
        title: standing.title,
        history: standing.ranks,
        totalPoints: standing.points,
      };
    });
}

export function reconcileSelectedCardIds(
  selected: readonly string[],
  room: PlayerRoomView | null,
): readonly string[] {
  if (selected.length === 0) return selected;
  const timedOutSelf = room?.events.some(
    (event) => event.t === 'turnTimeout' && event.seat === room.you.seatId,
  );
  if (timedOutSelf || room?.game?.status !== 'playing') return [];
  const handIds = new Set(room.game.yourHand.map((card) => card.id));
  const existing = selected.filter((id) => handIds.has(id));
  return existing.length === selected.length ? selected : existing;
}

function ConnectedApp({ client }: { client: MultiplayerClient }) {
  const current = useScreenStore((state) => state.current);
  const go = useScreenStore((state) => state.go);
  const state = useSyncExternalStore(
    client.subscribe,
    client.snapshot,
    client.snapshot,
  );
  const [isChoosingRoom, setIsChoosingRoom] = useState(false);
  const [selectedCardIds, setSelectedCardIds] = useState<readonly string[]>([]);
  const [funRating, setFunRating] = useState<SetFunRating | null>(null);
  const [ruleVotes, setRuleVotes] = useState(DEMO_FIRED_RULES);
  const [unreadProposalCount, setUnreadProposalCount] = useState(0);
  const proposalApi = getBrowserProposalClient();
  const room = state.room;

  useEffect(() => {
    setSelectedCardIds((selected) => reconcileSelectedCardIds(selected, room));
  }, [room]);

  useEffect(() => {
    if (current !== 'menu' || !proposalApi.mine) return;
    let active = true;
    void proposalApi
      .mine()
      .then((response) => {
        if (active) setUnreadProposalCount(response.unreadCount);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [current, proposalApi]);

  const invoke = (operation: Promise<unknown>) => {
    void operation.catch(() => undefined);
  };
  const show = (content: ReactNode) => (
    <ConnectionStatus state={state}>{content}</ConnectionStatus>
  );

  if (room?.phase === 'waiting') {
    const you = room.members.find(
      (member) => member.memberId === room.you.memberId,
    );
    return show(
      <WaitingRoomScreen
        members={waitingMembers(room)}
        inviteCode={room.inviteCode}
        activeRuleCount={room.activeRules.length}
        onBack={() => {
          if (!window.confirm('部屋から出ますか?')) return;
          invoke(
            client.leaveRoom().then(() => {
              go('menu');
            }),
          );
        }}
        onCopyInvite={() => {
          void navigator.clipboard?.writeText(room.inviteCode);
        }}
        onViewRules={() => undefined}
        onStart={() => {
          invoke(client.startRoom());
        }}
        canStart={you?.isHost === true}
      />,
    );
  }

  if (room?.phase === 'playing' && room.game?.status === 'playing') {
    const game = room.game;
    const selected = [...selectedCardIds].sort();
    const legalSelection =
      game.legalMoves?.some(
        (move) =>
          move.cards.length === selected.length &&
          move.cards
            .map((card) => card.id)
            .sort()
            .every((id, index) => id === selected[index]),
      ) ?? false;
    const leadMember = room.members.find(
      (member) => member.seatId === game.field.playedBySeat,
    );
    return show(
      <GameScreen
        gameLabel={`第${String(game.gameNo)}戦`}
        activeRuleCount={room.activeRules.length}
        seats={tableSeats(room)}
        finishes={seatFinishes(room)}
        leadSeatName={
          leadMember
            ? leadMember.memberId === room.you.memberId
              ? 'あなた'
              : leadMember.displayName
            : null
        }
        activations={[]}
        onCutInDone={() => undefined}
        lastActivation={null}
        hand={cards(game.yourHand)}
        selectedCardIds={selectedCardIds}
        isMyTurn={game.turn?.seat === room.you.seatId}
        canPlay={legalSelection}
        canPass={game.field.cards.length > 0}
        turnDeadlineAt={game.turn?.deadlineAt ?? null}
        onViewRules={() => undefined}
        onToggleCard={(id) => {
          setSelectedCardIds((ids) =>
            ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id],
          );
        }}
        onPlay={() => {
          if (!game.turn || !legalSelection) return;
          invoke(
            client.play(game.turn.turnSeq, [...selectedCardIds]).then(() => {
              setSelectedCardIds([]);
            }),
          );
        }}
        onPass={() => {
          if (!game.turn) return;
          invoke(client.pass(game.turn.turnSeq));
        }}
      />,
    );
  }

  if (room?.phase === 'playing' && room.game?.status === 'intermission') {
    const nextGame = room.game.gameNo + 1;
    const intermission = room.game.intermission;
    return show(
      <GameResultScreen
        title={`第${String(room.game.gameNo)}戦 おわり`}
        progressLabel={`セット ${String(room.game.gameNo)} / 3 戦`}
        ranks={gameRanks(room)}
        nextLabel={`第${String(nextGame)}戦へ`}
        autoAdvanceMs={intermission?.durationMs ?? 15_000}
        autoAdvanceAt={intermission?.endsAt ?? Date.now() + 15_000}
        onNext={() => {
          invoke(client.sync());
        }}
      />,
    );
  }

  if (room?.phase === 'setResult') {
    const you = room.members.find(
      (member) => member.memberId === room.you.memberId,
    );
    const waitingFor = you?.wantsNextSet
      ? room.members
          .filter(
            (member) =>
              !member.isAI &&
              !member.departed &&
              member.memberId !== room.you.memberId &&
              member.wantsNextSet !== true,
          )
          .map((member) => member.displayName)
      : null;
    return show(
      <SetResultScreen
        ranks={setRanks(room)}
        funRating={funRating}
        firedRules={ruleVotes}
        onChangeFunRating={setFunRating}
        onVoteRule={(ruleId, vote) => {
          setRuleVotes((rules) =>
            rules.map((rule) =>
              rule.ruleId === ruleId ? { ...rule, vote } : rule,
            ),
          );
        }}
        onPlayAgain={() => {
          invoke(client.continueRoom());
        }}
        onHome={() => {
          if (!window.confirm('部屋から出ますか?')) return;
          invoke(
            client.leaveRoom().then(() => {
              go('menu');
            }),
          );
        }}
        showEvaluation={false}
        waitingFor={waitingFor}
      />,
    );
  }

  if (current === 'title') {
    return show(<TitleScreen onStart={() => go('menu')} />);
  }
  if (current === 'proposal') {
    return show(
      <ProposalFormScreen
        api={getBrowserProposalClient()}
        onBack={() => go('menu')}
      />,
    );
  }
  if (current === 'myProposals') {
    return show(
      <MyProposalsScreen
        api={proposalApi}
        onBack={() => go('menu')}
        onUnreadCountChange={setUnreadProposalCount}
      />,
    );
  }
  return show(
    <>
      <MenuScreen
        onPlay={() => setIsChoosingRoom(true)}
        onPropose={() => go('proposal')}
        onEncyclopedia={() => undefined}
        onMyProposals={() => go('myProposals')}
        onHowToPlay={() => undefined}
        unreadProposalCount={unreadProposalCount}
      />
      {isChoosingRoom && (
        <PlaySheet
          onCreate={() => {
            invoke(
              client.createRoom().then(() => {
                setIsChoosingRoom(false);
              }),
            );
          }}
          onJoin={(inviteCode) => {
            invoke(
              client.joinRoom(inviteCode).then(() => {
                setIsChoosingRoom(false);
              }),
            );
          }}
          onClose={() => setIsChoosingRoom(false)}
          error={friendlyError(state.error)}
        />
      )}
    </>,
  );
}

function friendlyError(error: string | null): string | null {
  if (!error) return null;
  return (
    {
      ROOM_NOT_FOUND: '部屋が見つかりません。コードをたしかめてください',
      ROOM_FULL: 'この部屋は満員です',
      ROOM_IN_GAME: 'この部屋は対戦中です',
      RATE_LIMITED: 'しばらく待ってから、もう一度ためしてください',
    }[error] ?? '操作に失敗しました。もう一度ためしてください'
  );
}

export function App({
  client,
}: {
  client?: MultiplayerClient | null;
} = {}) {
  const effectiveClient =
    client === undefined
      ? import.meta.env.MODE === 'test'
        ? null
        : getBrowserMultiplayerClient()
      : client;
  return effectiveClient ? (
    <ConnectedApp client={effectiveClient} />
  ) : (
    <DemoApp />
  );
}
