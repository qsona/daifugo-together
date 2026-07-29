import type { PlayerRoomView } from '@daifugo/core';
import type { ReactNode } from 'react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import type { CardView } from './components/Card';
import type { MemberView as MemberListView } from './components/MemberList';
import type { GameRankView } from './components/GameRankRows';
import type { SetRankView } from './components/SetRankRows';
import type { TableSeat } from './components/Table';
import { RuleCutIn, type RuleActivation } from './components/RuleCutIn';
import { EmptyState } from './components/EmptyState';
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
import { ActiveRulesScreen } from './screens/ActiveRulesScreen';
import { RuleDexScreen } from './screens/RuleDexScreen';
import {
  getBrowserMultiplayerClient,
  type MultiplayerClient,
} from './multiplayer/client';
import { ConnectionStatus } from './multiplayer/ConnectionStatus';
import { PlaySheet } from './screens/PlaySheet';
import { getBrowserProposalClient, type ProposalApi } from './proposal/client';
import { ProposalFormScreen } from './screens/ProposalFormScreen';
import {
  getBrowserRuleCatalogClient,
  type RuleCatalogApi,
} from './rules/client';
import { SetResultScreen } from './screens/SetResultScreen';
import { TitleScreen } from './screens/TitleScreen';
import { WaitingRoomScreen } from './screens/WaitingRoomScreen';
import { useScreenStore } from './store/screen';
import {
  navigate,
  parseRoomRoute,
  roomPath,
  screenFromPathname,
} from './routing';
import screenStyles from './screens/screen.module.css';
import { deriveCardHints } from './game/hints';
import { getBrowserAuthClient, type AuthApi } from './auth/client';
import { FEATURES } from './features';
import {
  getBrowserEvaluationClient,
  type EvaluationApi,
} from './evaluation/client';
import { createGuideState, reduceGuide, type GuideCue } from './game/guide';
import {
  getPlayedBeforeStorage,
  hasPlayedBefore,
  markPlayedBefore,
  type PlayedBeforeStorage,
} from './tutorial/played-before';
import {
  isGraduationEmphasized,
  readGraduationState,
  reduceGraduationState,
  writeGraduationState,
} from './tutorial/graduation';

const GRADUATION_ERROR =
  'みんなのルールへ進めませんでした。もう一度ためしてください';
const AUTH_RESULT_PROMPT_KEY = 'daifugo.authResultPromptShown';

/**
 * 最終戦リザルトを見せる時間。
 * サーバーはこの間もセットリザルトのフェーズなので、これはこの端末だけの間。
 */
const FINAL_RESULT_MS = 10_000;

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

const DEMO_RULES = DEMO_FIRED_RULES.map((rule) => ({
  ruleId: rule.ruleId,
  name: rule.name,
}));

const DEMO_RULE_CATALOG_API: RuleCatalogApi = {
  list: async ({ limit = 30, offset = 0 } = {}) => ({
    summary: {
      implemented: DEMO_RULES.length,
      active: DEMO_RULES.length,
      removed: 0,
      prefectureCoverage: 1,
    },
    page: {
      total: DEMO_RULES.length,
      limit,
      offset,
    },
    items: DEMO_RULES.slice(offset, offset + limit).map((rule, index) => ({
      id: rule.ruleId,
      name: rule.name,
      description: '対局にひとひねり加えるルールです。',
      kind: index === 0 ? 'local' : 'original',
      prefecture: index === 0 ? '埼玉県' : null,
      status: 'active',
      priority: null,
      popularity: null,
      implementedAt: new Date().toISOString(),
      removedAt: null,
    })),
  }),
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
  const [activeRulesReturn, setActiveRulesReturn] = useState<
    'waitingRoom' | 'game'
  >('waitingRoom');

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
            onEncyclopedia={() => go('ruleDex')}
            onMyProposals={() => go('myProposals')}
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

    case 'activeRules':
      return (
        <ActiveRulesScreen
          rules={DEMO_RULES}
          onBack={() => go(activeRulesReturn)}
          onOpenDex={() => go('ruleDex')}
          showDexLink={FEATURES.ruleDex}
        />
      );

    case 'ruleDex':
      return (
        <RuleDexScreen api={DEMO_RULE_CATALOG_API} onBack={() => go('menu')} />
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
          onViewRules={() => {
            setActiveRulesReturn('waitingRoom');
            go('activeRules');
          }}
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
          onViewRules={() => {
            setActiveRulesReturn('game');
            go('activeRules');
          }}
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
          title="第3戦 おわり"
          progressLabel="セット 3 / 3 戦"
          ranks={DEMO_GAME_RANKS}
          nextLabel="セット結果へ"
          autoAdvanceMs={FINAL_RESULT_MS}
          autoAdvanceAt={Date.now() + FINAL_RESULT_MS}
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

function gameRanks(room: PlayerRoomView): GameRankView[] {
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

/**
 * セットリザルト直前に見せる最終戦の順位。
 * 加点は最終戦の順位点、合計点はセットの合計(最終戦なので両者は一致する)。
 */
function finalGameRanks(room: PlayerRoomView): GameRankView[] {
  const finalGame = room.setResult?.finalGame;
  if (!finalGame) return [];
  const totals = new Map(
    (room.setResult?.standings ?? []).map((standing) => [
      standing.memberId,
      standing.points,
    ]),
  );
  const bySeat = new Map(
    room.members.flatMap((member) =>
      member.seatId === null ? [] : ([[member.seatId, member]] as const),
    ),
  );
  return [...finalGame.standings]
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
        totalPoints: member
          ? (totals.get(member.memberId) ?? standing.points)
          : standing.points,
      };
    });
}

function setRanks(room: PlayerRoomView): SetRankView[] {
  const standings = room.setResult?.standings ?? [];
  return [...standings]
    .sort((left, right) => left.totalRank - right.totalRank)
    .map((standing) => {
      const member = room.members.find(
        (candidate) => candidate.memberId === standing.memberId,
      );
      return {
        place: standing.totalRank,
        name:
          standing.memberId === room.you.memberId
            ? 'あなた'
            : (member?.displayName ?? 'プレイヤー'),
        kind: member?.isAI ? ('ai' as const) : ('human' as const),
        title: standing.title,
        totalPoints: standing.points,
        isYou: standing.memberId === room.you.memberId,
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

function ConnectedApp({
  client,
  storage,
  evaluationApi,
  auth,
}: {
  client: MultiplayerClient;
  storage: PlayedBeforeStorage | undefined;
  evaluationApi: EvaluationApi;
  auth: AuthApi;
}) {
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
  const [ruleVotes, setRuleVotes] = useState<Record<string, RuleVote>>({});
  const [evaluationError, setEvaluationError] = useState<string | null>(null);
  const evaluationGeneration = useRef(0);
  const ratingRevision = useRef(0);
  const votesRevision = useRef(0);
  const evaluationQueue = useRef<Promise<void>>(Promise.resolve());
  const confirmedRating = useRef<SetFunRating | null>(null);
  const confirmedVotes = useRef<Record<string, RuleVote>>({});
  /** 最終戦リザルトを見終えたセット。sync や再接続で画面が巻き戻らないようにする。 */
  const [finalResultSeen, setFinalResultSeen] = useState<string | null>(null);
  const finalResultDeadline = useRef<{ key: string; at: number } | null>(null);
  const [unreadProposalCount, setUnreadProposalCount] = useState(0);
  const [authPending, setAuthPending] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [showResultAuthPrompt, setShowResultAuthPrompt] = useState(false);
  const proposalApi = getBrowserProposalClient();
  const ruleEventRoomId = useRef<string | null>(null);
  const lastRuleEventSeq = useRef(0);
  const seenRuleIds = useRef(new Set<string>());
  const [activationVolleys, setActivationVolleys] = useState<
    readonly (readonly RuleActivation[])[]
  >([]);
  const [lastActivation, setLastActivation] = useState<{
    name: string;
    count: number;
  } | null>(null);
  const guideState = useRef(createGuideState());
  const guideSessionKey = useRef<string | null>(null);
  const guideTurnSeq = useRef<number | null>(null);
  const [guideCue, setGuideCue] = useState<GuideCue | null>(null);
  const [playedBefore, setPlayedBefore] = useState(() =>
    hasPlayedBefore(storage),
  );
  const [graduationState, setGraduationState] = useState(() =>
    readGraduationState(storage),
  );
  const [graduationFrom, setGraduationFrom] = useState<PlayerRoomView | null>(
    null,
  );
  const [isGraduating, setIsGraduating] = useState(false);
  const [graduationError, setGraduationError] = useState<string | null>(null);
  const [playSheetError, setPlaySheetError] = useState<string | null>(null);
  const [roomOverlay, setRoomOverlay] = useState<
    'activeRules' | 'ruleDex' | null
  >(null);
  const ruleCatalogApi = getBrowserRuleCatalogClient();
  const room = state.room;
  const beginLogin = useCallback(() => {
    if (
      state.registered &&
      !window.confirm(
        '別のアカウントでログインすると、この端末はそのアカウントに切り替わります',
      )
    ) {
      return;
    }
    const userToken = client.currentUserToken();
    if (state.connection !== 'ready' || !userToken) {
      setAuthMessage('接続を確認中です。少し待ってからもう一度ためしてね');
      return;
    }
    setAuthPending(true);
    setAuthMessage(null);
    try {
      auth.begin(userToken);
    } catch {
      setAuthPending(false);
      setAuthMessage('うまくいかなかったみたい。もういちどためしてね');
    }
  }, [auth, client, state.connection, state.registered]);
  const routeAtRender =
    typeof window === 'undefined'
      ? null
      : parseRoomRoute(window.location.pathname);
  const routedRoomOverlay =
    room && routeAtRender?.roomId === room.roomId
      ? routeAtRender.view === 'rules'
        ? 'activeRules'
        : routeAtRender.view === 'rule-dex'
          ? 'ruleDex'
          : null
      : null;
  const visibleRoomOverlay = roomOverlay ?? routedRoomOverlay;
  const desiredRoomPath = room ? roomPath(room, visibleRoomOverlay) : null;

  useEffect(() => {
    if (desiredRoomPath) {
      navigate(desiredRoomPath, 'replace');
      return;
    }
    if (
      state.connection === 'ready' &&
      parseRoomRoute(window.location.pathname)
    ) {
      navigate('/menu', 'replace');
      useScreenStore.setState({ current: 'menu' });
    }
  }, [desiredRoomPath, state.connection]);

  useEffect(() => {
    const restoreOverlayFromUrl = () => {
      const route = parseRoomRoute(window.location.pathname);
      if (!room || !route || route.roomId !== room.roomId) {
        setRoomOverlay(null);
        return;
      }
      setRoomOverlay(
        route.view === 'rules'
          ? 'activeRules'
          : route.view === 'rule-dex'
            ? 'ruleDex'
            : null,
      );
    };
    window.addEventListener('popstate', restoreOverlayFromUrl);
    return () => window.removeEventListener('popstate', restoreOverlayFromUrl);
  }, [room]);
  const evaluationSetId =
    room?.phase === 'setResult'
      ? (room.setResult?.setId ?? null)
      : !room && isGraduating && graduationFrom?.phase === 'setResult'
        ? (graduationFrom.setResult?.setId ?? null)
        : null;
  useEffect(() => {
    let active = true;
    const generation = ++evaluationGeneration.current;
    ratingRevision.current = 0;
    votesRevision.current = 0;
    confirmedRating.current = null;
    confirmedVotes.current = {};
    const loadedRatingRevision = ratingRevision.current;
    const loadedVotesRevision = votesRevision.current;
    setFunRating(null);
    setRuleVotes({});
    setEvaluationError(null);
    if (!evaluationSetId) return () => undefined;
    void evaluationApi.get(evaluationSetId).then(
      (evaluation) => {
        if (!active || generation !== evaluationGeneration.current) return;
        const loadedVotes = Object.fromEntries(
          evaluation.ruleVotes.map((vote) => [vote.ruleId, vote.vote]),
        );
        if (ratingRevision.current === loadedRatingRevision) {
          confirmedRating.current = evaluation.setRating;
          setFunRating(evaluation.setRating);
        }
        if (votesRevision.current === loadedVotesRevision) {
          confirmedVotes.current = loadedVotes;
          setRuleVotes(loadedVotes);
        }
      },
      () => {
        if (
          active &&
          generation === evaluationGeneration.current &&
          ratingRevision.current === loadedRatingRevision &&
          votesRevision.current === loadedVotesRevision
        ) {
          setEvaluationError('評価を読み込めませんでした');
        }
      },
    );
    return () => {
      active = false;
    };
  }, [evaluationApi, evaluationSetId]);

  const saveSetRating = (rating: SetFunRating) => {
    if (!evaluationSetId) return;
    const generation = evaluationGeneration.current;
    const revision = ++ratingRevision.current;
    setFunRating(rating);
    setEvaluationError(null);
    const request = evaluationQueue.current.then(() =>
      evaluationApi.update(evaluationSetId, { setRating: rating }),
    );
    evaluationQueue.current = request.then(
      () => undefined,
      () => undefined,
    );
    void request.then(
      (evaluation) => {
        if (generation === evaluationGeneration.current) {
          confirmedRating.current = evaluation.setRating;
        }
        if (
          generation === evaluationGeneration.current &&
          revision === ratingRevision.current
        ) {
          setFunRating(evaluation.setRating);
        }
      },
      () => {
        if (
          generation === evaluationGeneration.current &&
          revision === ratingRevision.current
        ) {
          setFunRating(confirmedRating.current);
          setEvaluationError(
            '評価を送れませんでした。もう一度ためしてください',
          );
        }
      },
    );
  };
  const saveRuleVote = (ruleId: string, vote: RuleVote) => {
    if (!evaluationSetId) return;
    const generation = evaluationGeneration.current;
    const revision = ++votesRevision.current;
    setRuleVotes((current) => ({ ...current, [ruleId]: vote }));
    setEvaluationError(null);
    const request = evaluationQueue.current.then(() =>
      evaluationApi.update(evaluationSetId, {
        ruleVote: { ruleId, vote },
      }),
    );
    evaluationQueue.current = request.then(
      () => undefined,
      () => undefined,
    );
    void request.then(
      (evaluation) => {
        const confirmed = Object.fromEntries(
          evaluation.ruleVotes.map((entry) => [entry.ruleId, entry.vote]),
        );
        if (generation === evaluationGeneration.current) {
          confirmedVotes.current = confirmed;
        }
        if (
          generation === evaluationGeneration.current &&
          revision === votesRevision.current
        ) {
          setRuleVotes(confirmed);
        }
      },
      () => {
        if (
          generation === evaluationGeneration.current &&
          revision === votesRevision.current
        ) {
          setRuleVotes(confirmedVotes.current);
          setEvaluationError(
            '評価を送れませんでした。もう一度ためしてください',
          );
        }
      },
    );
  };
  const tutorialEligible =
    !playedBefore &&
    room?.mode === 'basic' &&
    room.phase === 'playing' &&
    room.game?.gameNo === 1 &&
    room.members.filter((member) => !member.isAI && !member.departed).length ===
      1;
  const tutorialSessionKey =
    tutorialEligible && room?.game
      ? `${room.roomId}:${String(room.game.gameNo)}`
      : null;

  useEffect(() => {
    setSelectedCardIds((selected) => reconcileSelectedCardIds(selected, room));
    if (!room) setRoomOverlay(null);
  }, [room]);

  useEffect(() => {
    if (!room) return;
    if (ruleEventRoomId.current !== room.roomId) {
      ruleEventRoomId.current = room.roomId;
      lastRuleEventSeq.current = 0;
      setActivationVolleys([]);
      setLastActivation(null);
    }
    const freshEvents = room.events
      .filter((event) => event.seq > lastRuleEventSeq.current)
      .toSorted((left, right) => left.seq - right.seq);
    if (freshEvents.length === 0) return;
    lastRuleEventSeq.current = Math.max(
      lastRuleEventSeq.current,
      ...freshEvents.map((event) => event.seq),
    );
    const fired = freshEvents.filter((event) => event.t === 'ruleFired');
    const unique = new Map<string, RuleActivation>();
    for (const event of fired) {
      if (event.t !== 'ruleFired') continue;
      if (!unique.has(event.ruleId)) {
        unique.set(event.ruleId, {
          ruleId: event.ruleId,
          name: event.name,
          ...(event.message === null ? {} : { effectLabel: event.message }),
          isFirstSeen: false,
        });
      }
    }
    if (unique.size > 0) {
      setActivationVolleys((volleys) => [...volleys, [...unique.values()]]);
    }
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

  useEffect(() => {
    setGraduationState((current) => {
      const next = reduceGraduationState(current, { playedBefore, room });
      const unchanged =
        next === current ||
        (next?.kind === 'candidate' &&
          current?.kind === 'candidate' &&
          next.roomId === current.roomId) ||
        (next?.kind === 'emphasized' &&
          current?.kind === 'emphasized' &&
          next.snapshotKey === current.snapshotKey);
      if (unchanged) {
        return current;
      }
      if (next) writeGraduationState(storage, next);
      return next;
    });
  }, [playedBefore, room, storage]);

  useEffect(() => {
    const completedOneGame =
      room?.phase === 'setResult' ||
      (room?.game?.previousResults.length ?? 0) > 0;
    if (!playedBefore && completedOneGame) {
      markPlayedBefore(storage);
      setPlayedBefore(true);
    }
  }, [playedBefore, room, storage]);

  useEffect(() => {
    if (room?.phase !== 'setResult' || state.registered) {
      setShowResultAuthPrompt(false);
      return;
    }
    try {
      if (storage?.getItem(AUTH_RESULT_PROMPT_KEY) === 'true') return;
      storage?.setItem(AUTH_RESULT_PROMPT_KEY, 'true');
    } catch {
      // Storage unavailable: showing the small prompt is still safe.
    }
    setShowResultAuthPrompt(true);
  }, [room?.phase, room?.roomId, state.registered, storage]);

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith('#/auth/complete')) return;
    const query = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
    const parameters = new URLSearchParams(query);
    const error = parameters.get('error');
    window.history.replaceState(null, '', '/menu');
    go('menu');
    if (error) {
      setAuthMessage('うまくいかなかったみたい。もういちどためしてね');
      return;
    }
    const ott = parameters.get('ott');
    if (!ott) {
      setAuthMessage('うまくいかなかったみたい。もういちどためしてね');
      return;
    }
    setAuthPending(true);
    void auth
      .complete(ott)
      .then((result) => {
        client.switchSession(result.userToken);
        setAuthMessage(
          result.outcome === 'linked' ? '引き継ぎ登録したよ' : 'おかえり!',
        );
      })
      .catch(() => {
        setAuthMessage('うまくいかなかったみたい。もういちどためしてね');
      })
      .finally(() => setAuthPending(false));
  }, [auth, client, go]);

  useEffect(() => {
    if (guideSessionKey.current === tutorialSessionKey) return;
    guideSessionKey.current = tutorialSessionKey;
    guideState.current = createGuideState();
    guideTurnSeq.current = null;
    setGuideCue(null);
  }, [tutorialSessionKey]);

  useEffect(() => {
    if (!tutorialEligible || !room?.game || guideCue) return;
    const result = reduceGuide(guideState.current, {
      type: 'snapshot',
      key: `${room.roomId}:${String(room.v)}`,
      gameNo: room.game.gameNo,
      isMyTurn: room.game.turn?.seat === room.you.seatId,
      fieldCardCount: room.game.field.cards.length,
      legalMoves: room.game.legalMoves,
      events: room.events,
    });
    guideState.current = result.state;
    if (result.cue) {
      guideTurnSeq.current = room.game.turn?.turnSeq ?? null;
      setGuideCue(result.cue);
    }
  }, [guideCue, room, tutorialEligible]);

  useEffect(() => {
    if (!guideCue) return;
    if (room?.game?.turn?.turnSeq === guideTurnSeq.current) return;
    guideTurnSeq.current = null;
    setGuideCue(null);
  }, [guideCue, room?.game?.turn?.turnSeq]);

  const invoke = (operation: Promise<unknown>) => {
    void operation.catch(() => undefined);
  };
  const currentActivationVolley = activationVolleys[0];
  const activations = useMemo(
    () =>
      (currentActivationVolley ?? []).map((activation) => ({
        ...activation,
        isFirstSeen: !seenRuleIds.current.has(activation.ruleId),
      })),
    [currentActivationVolley],
  );
  useEffect(() => {
    for (const activation of activations) {
      seenRuleIds.current.add(activation.ruleId);
    }
  }, [activations]);
  const finishRuleCutIn = useCallback(() => {
    if (activations.length > 0) {
      setLastActivation({
        name: activations.at(-1)!.name,
        count: activations.length,
      });
    }
    setActivationVolleys((volleys) => volleys.slice(1));
  }, [activations]);
  const show = (content: ReactNode) => (
    <>
      <ConnectionStatus state={state}>{content}</ConnectionStatus>
      <RuleCutIn activations={activations} onDone={finishRuleCutIn} />
    </>
  );
  const visibleSetResultRoom =
    room?.phase === 'setResult'
      ? room
      : !room && isGraduating && graduationFrom?.phase === 'setResult'
        ? graduationFrom
        : null;

  if (
    !room &&
    state.connection === 'connecting' &&
    parseRoomRoute(window.location.pathname)
  ) {
    return (
      <div className={screenStyles.screen}>
        <main className={screenStyles.body}>
          <EmptyState
            title="対局に戻っています"
            description="サーバーに再接続しています。少しだけお待ちください"
          />
        </main>
      </div>
    );
  }

  if (room && visibleRoomOverlay === 'activeRules') {
    return show(
      <ActiveRulesScreen
        rules={room.activeRules}
        onBack={() => {
          navigate(roomPath(room), 'replace');
          setRoomOverlay(null);
        }}
        onOpenDex={() => {
          navigate(roomPath(room, 'ruleDex'));
          setRoomOverlay('ruleDex');
        }}
        showDexLink={FEATURES.ruleDex}
      />,
    );
  }
  if (room && visibleRoomOverlay === 'ruleDex') {
    return show(
      <RuleDexScreen
        api={ruleCatalogApi}
        onBack={() => {
          navigate(roomPath(room, 'activeRules'), 'replace');
          setRoomOverlay('activeRules');
        }}
      />,
    );
  }

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
        onViewRules={() => {
          navigate(roomPath(room, 'activeRules'));
          setRoomOverlay('activeRules');
        }}
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
    const cardHints =
      room.mode === 'basic'
        ? deriveCardHints(game.yourHand, game.legalMoves, selectedCardIds)
        : undefined;
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
        onCutInDone={finishRuleCutIn}
        lastActivation={activations.length > 0 ? null : lastActivation}
        hand={cards(game.yourHand)}
        selectedCardIds={selectedCardIds}
        {...(cardHints ? { cardHints } : {})}
        guideCue={tutorialEligible ? guideCue : null}
        showStrengthScale={tutorialEligible}
        isMyTurn={game.turn?.seat === room.you.seatId}
        canPlay={legalSelection}
        canPass={game.field.cards.length > 0}
        turnDeadlineAt={game.turn?.deadlineAt ?? null}
        onViewRules={() => {
          navigate(roomPath(room, 'activeRules'));
          setRoomOverlay('activeRules');
        }}
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

  /*
   * セット最終戦だけサーバーは interimResult を挟まない(そのまま setResult へ進む)。
   * その戦の結果をセット総合と一緒に出すと 2 つの結果が混ざるので、
   * この端末の中でだけ最終戦リザルトを先に見せてからセットリザルトへ渡す。
   */
  const finalResultKey =
    room?.phase === 'setResult' && room.setResult?.finalGame
      ? `${room.roomId}:${String(room.setResult.respondBy)}`
      : null;
  if (room?.setResult?.finalGame && finalResultKey !== null) {
    if (finalResultSeen !== finalResultKey) {
      const gameNo = room.setResult.finalGame.gameNo;
      if (finalResultDeadline.current?.key !== finalResultKey) {
        finalResultDeadline.current = {
          key: finalResultKey,
          at: Date.now() + FINAL_RESULT_MS,
        };
      }
      const key = finalResultKey;
      return show(
        <GameResultScreen
          title={`第${String(gameNo)}戦 おわり`}
          progressLabel={`セット ${String(gameNo)} / ${String(gameNo)} 戦`}
          ranks={finalGameRanks(room)}
          nextLabel="セット結果へ"
          autoAdvanceMs={FINAL_RESULT_MS}
          autoAdvanceAt={finalResultDeadline.current.at}
          onNext={() => {
            setFinalResultSeen(key);
          }}
        />,
      );
    }
  }

  if (visibleSetResultRoom) {
    const resultRoom = visibleSetResultRoom;
    const you = resultRoom.members.find(
      (member) => member.memberId === resultRoom.you.memberId,
    );
    const waitingFor = you?.wantsNextSet
      ? resultRoom.members
          .filter(
            (member) =>
              !member.isAI &&
              !member.departed &&
              member.memberId !== resultRoom.you.memberId &&
              member.wantsNextSet !== true,
          )
          .map((member) => member.displayName)
      : null;
    return show(
      <SetResultScreen
        ranks={setRanks(resultRoom)}
        funRating={funRating}
        firedRules={(resultRoom.setResult?.firedRules ?? []).map((rule) => ({
          ruleId: rule.ruleId,
          name: rule.ruleName,
          vote: ruleVotes[rule.ruleId] ?? null,
        }))}
        onChangeFunRating={saveSetRating}
        onVoteRule={saveRuleVote}
        onPlayAgain={() => {
          invoke(client.continueRoom());
        }}
        {...(resultRoom.mode === 'basic'
          ? {
              onPlayCommunity: () => {
                if (isGraduating) return;
                setIsGraduating(true);
                setGraduationError(null);
                setGraduationFrom(resultRoom);
                void client.leaveRoom().then(
                  () => {
                    void client.createRoom('community').then(
                      () => {
                        setIsGraduating(false);
                        setGraduationFrom(null);
                      },
                      () => {
                        setIsGraduating(false);
                        setGraduationFrom(null);
                        setPlaySheetError(GRADUATION_ERROR);
                        go('menu');
                        setIsChoosingRoom(true);
                      },
                    );
                  },
                  () => {
                    setIsGraduating(false);
                    setGraduationError(GRADUATION_ERROR);
                  },
                );
              },
              emphasizePlayCommunity: isGraduationEmphasized(
                graduationState,
                resultRoom,
              ),
            }
          : {})}
        onHome={() => {
          if (!window.confirm('部屋から出ますか?')) return;
          invoke(
            client.leaveRoom().then(() => {
              go('menu');
            }),
          );
        }}
        actionError={evaluationError ?? graduationError}
        showEvaluation
        waitingFor={waitingFor}
        actionPending={isGraduating}
        {...(showResultAuthPrompt ? { onRegister: beginLogin } : {})}
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
        registered={state.registered}
        onLogin={beginLogin}
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
  if (current === 'ruleDex') {
    return show(
      <RuleDexScreen api={ruleCatalogApi} onBack={() => go('menu')} />,
    );
  }
  return show(
    <>
      <MenuScreen
        onPlay={() => {
          setPlaySheetError(null);
          setIsChoosingRoom(true);
        }}
        onPropose={() => go('proposal')}
        onEncyclopedia={() => go('ruleDex')}
        onMyProposals={() => go('myProposals')}
        registered={state.registered}
        onLogin={beginLogin}
        onLogout={() => {
          client.switchSession(null);
          setAuthMessage('ログアウトしました');
        }}
        authPending={authPending}
        authMessage={authMessage}
        unreadProposalCount={unreadProposalCount}
      />
      {isChoosingRoom && (
        <PlaySheet
          initialMode={playSheetError === GRADUATION_ERROR ? 'community' : null}
          onCreate={(mode) => {
            setPlaySheetError(null);
            invoke(
              client.createRoom(mode).then(() => {
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
          onClose={() => {
            setIsChoosingRoom(false);
            setPlaySheetError(null);
          }}
          error={playSheetError ?? friendlyError(state.error)}
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
  storage,
  evaluationApi,
  auth,
}: {
  client?: MultiplayerClient | null;
  storage?: PlayedBeforeStorage;
  evaluationApi?: EvaluationApi;
  auth?: AuthApi;
} = {}) {
  useEffect(() => {
    const restoreScreenFromUrl = () => {
      useScreenStore.setState({
        current: screenFromPathname(window.location.pathname),
      });
    };
    window.addEventListener('popstate', restoreScreenFromUrl);
    return () => window.removeEventListener('popstate', restoreScreenFromUrl);
  }, []);

  const effectiveClient =
    client === undefined
      ? import.meta.env.MODE === 'test'
        ? null
        : getBrowserMultiplayerClient()
      : client;
  const effectiveStorage =
    storage ??
    (import.meta.env.MODE === 'test'
      ? undefined
      : getPlayedBeforeStorage(
          typeof window === 'undefined' ? undefined : window,
        ));
  const effectiveEvaluationApi =
    evaluationApi ??
    (import.meta.env.MODE === 'test'
      ? {
          get: async () => ({ setRating: null, ruleVotes: [] }),
          update: async (
            _setId: string,
            update:
              | { setRating: SetFunRating }
              | { ruleVote: { ruleId: string; vote: RuleVote } },
          ) => ({
            setRating: 'setRating' in update ? update.setRating : null,
            ruleVotes:
              'ruleVote' in update && update.ruleVote.vote !== null
                ? [
                    {
                      ruleId: update.ruleVote.ruleId,
                      vote: update.ruleVote.vote,
                    },
                  ]
                : [],
          }),
        }
      : getBrowserEvaluationClient());
  const effectiveAuth =
    auth ??
    (typeof window === 'undefined'
      ? {
          begin: async () => {
            throw new Error('auth_unavailable');
          },
          complete: async () => {
            throw new Error('auth_unavailable');
          },
        }
      : getBrowserAuthClient());
  return effectiveClient ? (
    <ConnectedApp
      client={effectiveClient}
      storage={effectiveStorage}
      evaluationApi={effectiveEvaluationApi}
      auth={effectiveAuth}
    />
  ) : (
    <DemoApp />
  );
}
