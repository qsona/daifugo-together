import type {
  NotificationView,
  PlayerRoomView,
  SeatOption,
} from '@daifugo/core';
import type { ReactNode } from 'react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import type { MemberView as MemberListView } from './components/MemberList';
import type { GameRankView } from './components/GameRankRows';
import type { SetRankView } from './components/SetRankRows';
import { FinalPlayReveal } from './components/FinalPlayReveal';
import { RuleCutIn, type RuleActivation } from './components/RuleCutIn';
import { EmptyState } from './components/EmptyState';
import { NotificationBell } from './components/NotificationBell';
import { PushOfferDialog } from './components/PushOfferDialog';
import { ActiveRulesModal } from './components/ActiveRulesModal';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ConnectDialog } from './components/ConnectDialog';
import { Button } from './components/Button';
import { Dialog, DialogBody } from './components/Dialog';
import { Toast } from './components/Toast';
import { BombThrowMiniGame } from './components/BombThrowMiniGame';
import { RuleDetailModal } from './components/RuleDetailModal';
import type { RuleVote, SetFunRating } from './screens/SetResultScreen';
import {
  DEMO_ACTIVATION_VOLLEYS,
  DEMO_ACTIVE_RULE_COUNT,
  DEMO_FIRED_RULES,
  DEMO_GAME_RANKS,
  DEMO_GAME_STATUSES,
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
import { NotificationsScreen } from './screens/NotificationsScreen';
import { RuleBalanceNoticeScreen } from './screens/RuleBalanceNoticeScreen';
import { NextSetWaitingScreen } from './screens/NextSetWaitingScreen';
import { PushSettingsScreen } from './screens/PushSettingsScreen';
import { ActiveRulesScreen } from './screens/ActiveRulesScreen';
import { RuleDexScreen } from './screens/RuleDexScreen';
import { AccountScreen } from './screens/AccountScreen';
import { NameScreen } from './screens/NameScreen';
import {
  getBrowserMultiplayerClient,
  type MultiplayerClient,
} from './multiplayer/client';
import { ConnectionStatus } from './multiplayer/ConnectionStatus';
import { PlaySheet, type PlayResumeIntent } from './screens/PlaySheet';
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
  inviteCodeFromSearch,
  navigate,
  parseRoomRoute,
  roomInviteUrl,
  roomPath,
  screenFromPathname,
} from './routing';
import screenStyles from './screens/screen.module.css';
import { choicePresentation } from './game/choice';
import { deriveCardHints } from './game/hints';
import {
  cardDiscardNotices,
  cards,
  finalPlay,
  pendingFieldClearPlayIndex,
  seatFinishes,
  seatDisplayName,
  tableSeats,
  type FinalPlay,
} from './game/table';
import {
  AuthApiError,
  getBrowserAuthClient,
  type AuthApi,
  type AuthCompleteResponse,
} from './auth/client';
import { FEATURES } from './features';
import { getBrowserNotificationClient } from './notification/client';
import {
  getBrowserPushClient,
  type PushClient,
  type PushOfferKind,
} from './push/client';
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
import {
  CONFIRM_BACK_LABEL,
  LEAVE_ROOM_CONFIRM_LABEL,
  LEAVE_ROOM_TITLE,
  QUIT_GAME_LABEL,
  QUIT_GAME_MULTI_DESCRIPTION,
  QUIT_GAME_TITLE,
  RATING_SUBMIT_ERROR,
  RETRY_GENERIC_ERROR,
} from './messages';
import feedbackStyles from './RootFeedback.module.css';

const GRADUATION_ERROR =
  'みんなのルールへ進めませんでした。もう一度ためしてください。';
const AUTH_STARTED_REGISTERED_KEY = 'daifugo.authStartedRegistered';
const AUTH_COMPLETED_SET_COUNT_KEY = 'daifugo.authCompletedSetCount';
const AUTH_LAST_COUNTED_SET_KEY = 'daifugo.authLastCountedSet';
const AUTH_MENU_PROMPT_LAST_COUNT_KEY = 'daifugo.authMenuPromptLastCount';
const AUTH_PLAY_RESUME_KEY = 'daifugo.authPlayResume';
const AUTH_MENU_PROMPT_FREQUENCY = 3;

type AuthResultDialog =
  | { kind: 'switched'; registeredBefore: boolean; displayName: string }
  | { kind: 'expired' }
  | { kind: 'unavailable' };

function safeSessionGet(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSessionSet(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // 認証自体は保存領域が使えない環境でも続ける。
  }
}

function safeSessionRemove(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // 保存できない環境では復帰情報も使わない。
  }
}

function readAuthPlayResume(): PlayResumeIntent | null {
  const raw = safeSessionGet(AUTH_PLAY_RESUME_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PlayResumeIntent>;
    if (value.kind === 'create') return { kind: 'create' };
    if (
      value.kind === 'join' &&
      typeof value.inviteCode === 'string' &&
      /^\d{0,5}$/u.test(value.inviteCode)
    ) {
      return { kind: 'join', inviteCode: value.inviteCode };
    }
  } catch {
    // 壊れた復帰情報は無視する。
  }
  return null;
}

function storageNumber(
  storage: PlayedBeforeStorage | undefined,
  key: string,
): number {
  try {
    const value = Number(storage?.getItem(key));
    return Number.isFinite(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

function storageValue(
  storage: PlayedBeforeStorage | undefined,
  key: string,
): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function storageWrite(
  storage: PlayedBeforeStorage | undefined,
  key: string,
  value: string,
): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // 誘いの頻度管理が失敗しても対局と認証は止めない。
  }
}

function waitForReadySession(client: MultiplayerClient): Promise<string> {
  const current = client.snapshot();
  const currentToken = client.currentUserToken();
  if (current.connection === 'ready' && currentToken) {
    return Promise.resolve(currentToken);
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe: () => void = () => undefined;
    const finish = (token: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      unsubscribe();
      resolve(token);
    };
    const timeout = window.setTimeout(() => {
      settled = true;
      unsubscribe();
      reject(new Error('session_refresh_timeout'));
    }, 8_000);
    unsubscribe = client.subscribe(() => {
      const token = client.currentUserToken();
      if (client.snapshot().connection !== 'ready' || !token) return;
      finish(token);
    });
    if (settled) unsubscribe();
  });
}

/**
 * 最終戦リザルトを見せる時間。
 * サーバーはこの間もセットリザルトのフェーズなので、これはこの端末だけの間。
 */
const FINAL_RESULT_MS = 10_000;
/** 最後の人が出した手を結果画面へ進む前に確認できる時間。 */
const FINAL_PLAY_REVEAL_MS = 1_800;
/** 場が流れるアニメーションの尺。design-tokens の --duration-slow と合わせる。 */
const FIELD_FLUSH_MS = 320;

type RoomOverlay =
  { kind: 'activeRules'; ruleId: string | null } | { kind: 'ruleDex' } | null;

type ActivationVolley = {
  activations: readonly RuleActivation[];
  heldPlayedHistoryIndex: number | null;
};

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
      occupiesSlot: true,
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
  get: async (ruleId: string) => {
    const index = DEMO_RULES.findIndex((rule) => rule.ruleId === ruleId);
    if (index < 0) throw new Error('rule_catalog_unavailable');
    return {
      id: ruleId,
      name: DEMO_RULES[index]!.name,
      description: '対局にひとひねり加えるルールです。',
      kind: index === 0 ? ('local' as const) : ('original' as const),
      prefecture: index === 0 ? '埼玉県' : null,
      status: 'active' as const,
      priority: null,
      popularity: null,
      implementedAt: new Date().toISOString(),
      removedAt: null,
    };
  },
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
  const [demoDisplayName, setDemoDisplayName] = useState('ゲスト000001');
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
            displayName={demoDisplayName}
            accountState="anonymous"
            onOpenAccount={() => go('account')}
            onConnect={() => go('account')}
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

    case 'account':
      return (
        <AccountScreen
          api={DEMO_PROPOSAL_API}
          displayName={demoDisplayName}
          registered={false}
          connection="ready"
          onBack={() => go('menu')}
          onRename={() => go('name')}
          onOpenProposals={() => go('myProposals')}
          onConnect={() => undefined}
          onSwitch={() => undefined}
          onSignOut={() => undefined}
        />
      );

    case 'name':
      return (
        <NameScreen
          displayName={demoDisplayName}
          connection="ready"
          rename={async (displayName) => setDemoDisplayName(displayName)}
          onBack={() => go('account')}
        />
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
          inviteUrl={roomInviteUrl(DEMO_INVITE_CODE, window.location.origin)}
          activeRuleCount={DEMO_ACTIVE_RULE_COUNT}
          onBack={() => {
            go('menu');
          }}
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
          statuses={DEMO_GAME_STATUSES}
          strengthInverted
          activations={activations}
          onCutInDone={finishCutIn}
          lastActivation={
            lastVolley && lastVolley[0]
              ? {
                  ruleId: lastVolley[0].ruleId,
                  name: lastVolley[0].name,
                  count: lastVolley.length,
                }
              : null
          }
          hand={DEMO_HAND}
          selectedCardIds={selectedCardIds}
          isMyTurn
          onViewRules={() => {
            setActiveRulesReturn('game');
            go('activeRules');
          }}
          onOpenActivation={() => {
            setActiveRulesReturn('game');
            go('activeRules');
          }}
          onQuit={() => {
            go('menu');
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
          waitingForOthers={false}
          onNext={() => {
            go('setResult');
          }}
          onQuit={() => {
            go('menu');
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

function waitingMembers(room: PlayerRoomView): MemberListView[] {
  const members: MemberListView[] = room.members.map((member) =>
    member.isAI
      ? { kind: 'ai', name: member.displayName }
      : {
          kind: 'human',
          name: seatDisplayName(
            member.displayName,
            member.memberId === room.you.memberId,
          ),
          isSelf: member.memberId === room.you.memberId,
          ...(member.isHost ? { role: 'ホスト' } : {}),
          ...(!member.connected ? { status: '切断中' } : {}),
        },
  );
  while (members.length < 4) members.push({ kind: 'empty' });
  return members;
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
        name: seatDisplayName(
          member?.displayName ?? `席${String(standing.seat + 1)}`,
          member?.memberId === room.you.memberId,
        ),
        kind: member?.isAI ? ('ai' as const) : ('human' as const),
        title: standing.title,
        gainedPoints: standing.points,
        totalPoints: cumulative.get(standing.seat) ?? standing.points,
        isYou: member?.memberId === room.you.memberId,
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
        name: seatDisplayName(
          member?.displayName ?? `席${String(standing.seat + 1)}`,
          member?.memberId === room.you.memberId,
        ),
        kind: member?.isAI ? ('ai' as const) : ('human' as const),
        title: standing.title,
        gainedPoints: standing.points,
        totalPoints: member
          ? (totals.get(member.memberId) ?? standing.points)
          : standing.points,
        isYou: member?.memberId === room.you.memberId,
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
      const name = seatDisplayName(
        member?.displayName ?? 'プレイヤー',
        standing.memberId === room.you.memberId,
      );
      return {
        place: standing.totalRank,
        name: member?.joinedMidSet ? `${name}（AI分を含む）` : name,
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

type FinalPlayRevealState = {
  playerName: string;
  cards: FinalPlay['cards'];
};

function useFinalPlayReveal(
  room: PlayerRoomView | null,
): FinalPlayRevealState | null {
  const [reveal, setReveal] = useState<FinalPlayRevealState | null>(null);
  const seenKey = useRef<string | null>(null);
  const play = room ? finalPlay(room) : null;
  const playKey =
    room && play
      ? [
          room.roomId,
          room.game?.gameNo ?? room.setResult?.setId ?? '',
          String(play.seat),
          play.cards.map((card) => card.id).join(','),
        ].join(':')
      : null;

  useEffect(() => {
    if (!room || !play || !playKey) {
      setReveal(null);
      return;
    }
    if (seenKey.current === playKey) return;
    seenKey.current = playKey;
    const member = room.members.find(
      (candidate) => candidate.seatId === play.seat,
    );
    setReveal({
      playerName: seatDisplayName(
        member?.displayName ?? `席${String(play.seat + 1)}`,
        member?.memberId === room.you.memberId,
      ),
      cards: play.cards,
    });
  }, [playKey, room]);

  useEffect(() => {
    if (!reveal) return;
    const timer = window.setTimeout(() => {
      setReveal(null);
    }, FINAL_PLAY_REVEAL_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [reveal]);

  return reveal;
}

function ConnectedApp({
  client,
  storage,
  evaluationApi,
  auth,
  pushApi,
}: {
  client: MultiplayerClient;
  storage: PlayedBeforeStorage | undefined;
  evaluationApi: EvaluationApi;
  auth: AuthApi;
  pushApi: PushClient;
}) {
  const current = useScreenStore((state) => state.current);
  const go = useScreenStore((state) => state.go);
  const state = useSyncExternalStore(
    client.subscribe,
    client.snapshot,
    client.snapshot,
  );
  const sharedInviteCode =
    typeof window === 'undefined'
      ? null
      : inviteCodeFromSearch(window.location.search);
  const authCallbackAtRender =
    typeof window !== 'undefined' &&
    window.location.hash.startsWith('#/auth/complete');
  const initialPlayResume = useRef<PlayResumeIntent | null>(
    authCallbackAtRender ? readAuthPlayResume() : null,
  );
  const [playResume, setPlayResume] = useState<PlayResumeIntent | null>(
    initialPlayResume.current,
  );
  const [isChoosingRoom, setIsChoosingRoom] = useState(
    sharedInviteCode !== null || initialPlayResume.current !== null,
  );
  const [joinSeatChoice, setJoinSeatChoice] = useState<{
    inviteCode: string;
    seats: SeatOption[];
  } | null>(null);
  const [takeoverPendingMemberId, setTakeoverPendingMemberId] = useState<
    string | null
  >(null);
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
  const [connectDialog, setConnectDialog] = useState<{
    continueToPush: boolean;
    resumePlay?: PlayResumeIntent;
  } | null>(null);
  const [accountDialog, setAccountDialog] = useState<
    'switch' | 'signOut' | null
  >(null);
  const [signOutHasSubscription, setSignOutHasSubscription] = useState(false);
  const [authResultDialog, setAuthResultDialog] =
    useState<AuthResultDialog | null>(null);
  const [rootToast, setRootToast] = useState<string | null>(null);
  const [completedSetCount, setCompletedSetCount] = useState(() =>
    storageNumber(storage, AUTH_COMPLETED_SET_COUNT_KEY),
  );
  const countedSetId = useRef<string | null>(
    storageValue(storage, AUTH_LAST_COUNTED_SET_KEY),
  );
  const [showMenuConnectPrompt, setShowMenuConnectPrompt] = useState(false);
  const [menuPushOfferKind, setMenuPushOfferKind] =
    useState<PushOfferKind | null>(null);
  const proposalApi = getBrowserProposalClient();
  const notificationApi = getBrowserNotificationClient();
  const ruleEventRoomId = useRef<string | null>(null);
  const lastRuleEventSeq = useRef(0);
  const takeoverEventRoomId = useRef<string | null>(null);
  const lastTakeoverEventSeq = useRef(0);
  const seenRuleIds = useRef(new Set<string>());
  const customPresentationRuleIds = useRef(new Set<string>());
  const [activationVolleys, setActivationVolleys] = useState<
    readonly ActivationVolley[]
  >([]);
  const [isFlushingField, setIsFlushingField] = useState(false);
  const [lastActivation, setLastActivation] = useState<{
    ruleId: string;
    name: string;
    count: number;
    effectLabel?: string;
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
  const [roomOverlay, setRoomOverlay] = useState<RoomOverlay>(null);
  /** 部屋を離れる確認ダイアログ。待機中と対局中で文言が変わる。 */
  const [leaveConfirm, setLeaveConfirm] = useState<'waiting' | 'game' | null>(
    null,
  );
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const ruleCatalogApi = getBrowserRuleCatalogClient();
  const room = state.room;
  const notificationBell = (
    <NotificationBell
      unreadCount={state.unreadNotificationCount ?? 0}
      onClick={() => go('notifications')}
    />
  );
  const finalPlayReveal = useFinalPlayReveal(room);
  const openConnectDialog = useCallback(
    (continueToPush = false, resumePlay?: PlayResumeIntent) => {
      if (continueToPush) pushApi.markOfferAfterLogin();
      setConnectDialog({
        continueToPush,
        ...(resumePlay ? { resumePlay } : {}),
      });
    },
    [pushApi],
  );
  const closeConnectDialog = useCallback(() => {
    setConnectDialog((current) => {
      if (current?.continueToPush) pushApi.consumeOfferAfterLogin();
      return null;
    });
  }, [pushApi]);
  const beginLogin = useCallback(async (): Promise<void> => {
    const userToken = client.currentUserToken();
    if (state.connection !== 'ready' || !userToken) {
      return;
    }
    safeSessionSet(AUTH_STARTED_REGISTERED_KEY, String(state.registered));
    if (connectDialog?.resumePlay) {
      safeSessionSet(
        AUTH_PLAY_RESUME_KEY,
        JSON.stringify(connectDialog.resumePlay),
      );
    } else {
      safeSessionRemove(AUTH_PLAY_RESUME_KEY);
    }
    setAuthPending(true);
    try {
      try {
        await auth.begin(userToken);
      } catch (error) {
        if (!(error instanceof AuthApiError) || error.status !== 401)
          throw error;
        client.switchSession(null);
        await auth.begin(await waitForReadySession(client));
      }
    } catch (error) {
      safeSessionRemove(AUTH_PLAY_RESUME_KEY);
      setAuthPending(false);
      if (connectDialog?.continueToPush) pushApi.consumeOfferAfterLogin();
      setConnectDialog(null);
      setAccountDialog(null);
      setAuthResultDialog(
        error instanceof AuthApiError && error.status === 503
          ? { kind: 'unavailable' }
          : { kind: 'expired' },
      );
    }
  }, [
    auth,
    client,
    connectDialog,
    pushApi,
    state.connection,
    state.registered,
  ]);
  const beginPushLogin = useCallback(() => {
    openConnectDialog(true);
  }, [openConnectDialog]);
  const offerMenuPromptAfterCompletedSet = useCallback(() => {
    if (state.registered) return;
    const lastShown = storageNumber(storage, AUTH_MENU_PROMPT_LAST_COUNT_KEY);
    if (
      completedSetCount === 1 ||
      completedSetCount - lastShown >= AUTH_MENU_PROMPT_FREQUENCY
    ) {
      setShowMenuConnectPrompt(true);
    }
  }, [completedSetCount, state.registered, storage]);
  const markMenuPromptShown = useCallback(() => {
    storageWrite(
      storage,
      AUTH_MENU_PROMPT_LAST_COUNT_KEY,
      String(completedSetCount),
    );
  }, [completedSetCount, storage]);
  const routeAtRender =
    typeof window === 'undefined'
      ? null
      : parseRoomRoute(window.location.pathname);
  const routedRoomOverlay: RoomOverlay =
    room && routeAtRender?.roomId === room.roomId
      ? routeAtRender.view === 'rules'
        ? { kind: 'activeRules', ruleId: routeAtRender.ruleId ?? null }
        : routeAtRender.view === 'rule-dex'
          ? { kind: 'ruleDex' }
          : null
      : null;
  const visibleRoomOverlay = roomOverlay ?? routedRoomOverlay;
  const desiredRoomPath = room
    ? roomPath(
        room,
        visibleRoomOverlay?.kind === 'activeRules'
          ? 'activeRules'
          : visibleRoomOverlay?.kind === 'ruleDex'
            ? 'ruleDex'
            : null,
        visibleRoomOverlay?.kind === 'activeRules'
          ? (visibleRoomOverlay.ruleId ?? undefined)
          : undefined,
      )
    : null;

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
    if (state.connection !== 'ready') return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('src') !== 'push') return;
    const rawId = url.searchParams.get('nid');
    if (!rawId || !/^[1-9]\d*$/u.test(rawId)) return;
    void notificationApi.opened(Number(rawId), 'push').finally(() => {
      url.searchParams.delete('src');
      url.searchParams.delete('nid');
      window.history.replaceState(
        {},
        '',
        `${url.pathname}${url.search}${url.hash}`,
      );
    });
  }, [notificationApi, state.connection]);

  // ホーム画面アプリとしての起動を記録する(A2HS 施策の効果測定。E17 §2.7)。
  useEffect(() => {
    if (state.connection !== 'ready') return;
    void pushApi.reportInstalled();
  }, [pushApi, state.connection]);

  useEffect(() => {
    const restoreOverlayFromUrl = () => {
      const route = parseRoomRoute(window.location.pathname);
      if (!room || !route || route.roomId !== room.roomId) {
        setRoomOverlay(null);
        return;
      }
      setRoomOverlay(
        route.view === 'rules'
          ? { kind: 'activeRules', ruleId: route.ruleId ?? null }
          : route.view === 'rule-dex'
            ? { kind: 'ruleDex' }
            : null,
      );
    };
    window.addEventListener('popstate', restoreOverlayFromUrl);
    return () => window.removeEventListener('popstate', restoreOverlayFromUrl);
  }, [room]);
  const evaluationSetId =
    room?.phase === 'setResult' && room.you.seatId !== null
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
          setEvaluationError(RATING_SUBMIT_ERROR);
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
          setEvaluationError(RATING_SUBMIT_ERROR);
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
    // ミニゲームには専用の発動演出がある。結果フェーズの背後で汎用カットインを
    // 再生すると、オーバーレイが消える直前の一瞬だけ末尾が見えてしまう。
    const miniGameRuleId = room.game?.miniGame
      ? (room.game.pendingChoice?.ruleId ?? null)
      : null;
    const fired = freshEvents.filter(
      (event) =>
        event.t === 'ruleFired' &&
        event.ruleId !== miniGameRuleId &&
        !customPresentationRuleIds.current.has(event.ruleId),
    );
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
      setActivationVolleys((volleys) => [
        ...volleys,
        {
          activations: [...unique.values()],
          heldPlayedHistoryIndex: pendingFieldClearPlayIndex(room),
        },
      ]);
    }
  }, [room]);

  useEffect(() => {
    if (!room) return;
    if (takeoverEventRoomId.current !== room.roomId) {
      takeoverEventRoomId.current = room.roomId;
      lastTakeoverEventSeq.current = 0;
    }
    const event = room.events
      .filter(
        (candidate) =>
          candidate.t === 'seatTakeover' &&
          candidate.seq > lastTakeoverEventSeq.current,
      )
      .toSorted((left, right) => left.seq - right.seq)
      .at(-1);
    if (!event || event.t !== 'seatTakeover') return;
    lastTakeoverEventSeq.current = event.seq;
    setRootToast(
      `${event.displayName}さんが参加しました(${event.previousName}の席)`,
    );
  }, [room]);

  const currentMiniGameRuleId = room?.game?.miniGame
    ? (room.game.pendingChoice?.ruleId ?? null)
    : null;
  useEffect(() => {
    if (!currentMiniGameRuleId) return;
    // ruleFired がミニゲーム開始より先に届く場合もある。専用演出が始まったら、
    // 同じルールの汎用カットインと、その終了後に残る発動チップを取り消す。
    seenRuleIds.current.add(currentMiniGameRuleId);
    customPresentationRuleIds.current.add(currentMiniGameRuleId);
    setActivationVolleys((volleys) =>
      volleys.flatMap((volley) => {
        const remaining = volley.activations.filter(
          (activation) => activation.ruleId !== currentMiniGameRuleId,
        );
        return remaining.length > 0
          ? [{ ...volley, activations: remaining }]
          : [];
      }),
    );
    setLastActivation((activation) =>
      activation?.ruleId === currentMiniGameRuleId ? null : activation,
    );
  }, [currentMiniGameRuleId]);

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
      (room?.phase === 'setResult' && room.you.seatId !== null) ||
      (room?.game?.previousResults.length ?? 0) > 0;
    if (!playedBefore && completedOneGame) {
      markPlayedBefore(storage);
      setPlayedBefore(true);
    }
  }, [playedBefore, room, storage]);

  useEffect(() => {
    const setId =
      room?.phase === 'setResult' && room.you.seatId !== null
        ? room.setResult?.setId
        : null;
    if (!setId) return;
    if (countedSetId.current === setId) return;
    const next = completedSetCount + 1;
    countedSetId.current = setId;
    setCompletedSetCount(next);
    storageWrite(storage, AUTH_COMPLETED_SET_COUNT_KEY, String(next));
    storageWrite(storage, AUTH_LAST_COUNTED_SET_KEY, setId);
  }, [completedSetCount, room, storage]);

  useEffect(() => {
    if (current !== 'menu' || state.registered) {
      setShowMenuConnectPrompt(false);
    }
  }, [current, state.registered]);

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith('#/auth/complete')) return;
    const query = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
    const parameters = new URLSearchParams(query);
    const error = parameters.get('error');
    safeSessionRemove(AUTH_PLAY_RESUME_KEY);
    window.history.replaceState(null, '', '/menu');
    go('menu');
    const continueToPush = pushApi.consumeOfferAfterLogin();
    if (error === 'denied') {
      return;
    }
    if (error) {
      setAuthResultDialog({ kind: 'expired' });
      return;
    }
    const ott = parameters.get('ott');
    if (!ott) {
      setAuthResultDialog({ kind: 'expired' });
      return;
    }
    setAuthPending(true);
    void auth.complete(ott).then(
      (result: AuthCompleteResponse) => {
        client.switchSession(result.userToken);
        if (result.outcome === 'linked') {
          setRootToast('Googleでログインしました');
        } else if (result.outcome === 'already') {
          setRootToast('すでにログインしています');
        } else {
          setAuthResultDialog({
            kind: 'switched',
            registeredBefore:
              safeSessionGet(AUTH_STARTED_REGISTERED_KEY) === 'true',
            displayName: result.displayName,
          });
        }
        if (continueToPush) {
          void pushApi
            .offer()
            .then((kind) => setMenuPushOfferKind(kind))
            .catch(() => undefined);
        }
        setAuthPending(false);
      },
      () => {
        setAuthPending(false);
        setAuthResultDialog({ kind: 'expired' });
      },
    );
  }, [auth, client, go, pushApi]);

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

  const roomPhase = room?.phase ?? null;
  // 部屋の局面が変わったら確認は取り下げる。
  // (セット結果へ抜けたあと、次のセットで開きっぱなしに見えるのを防ぐ)
  useEffect(() => {
    setLeaveConfirm(null);
    setLeaveError(null);
  }, [roomPhase]);

  const invoke = (operation: Promise<unknown>) => {
    void operation.catch(() => undefined);
  };
  const currentActivationVolley = activationVolleys[0];
  const activations = useMemo(
    () =>
      (currentActivationVolley?.activations ?? []).map((activation) => ({
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
  const latestPlayedHistoryIndex =
    room?.game?.history.findLastIndex((event) => event.t === 'played') ?? -1;
  const heldPlayedHistoryIndex =
    currentActivationVolley?.heldPlayedHistoryIndex ?? null;
  // 演出中にも対局は進む。次の札が着地済みなら古い札の吸い込みは省略し、
  // 最新 snapshot の場へ即座に切り替える。
  const heldPlayWasSuperseded =
    heldPlayedHistoryIndex !== null &&
    latestPlayedHistoryIndex > heldPlayedHistoryIndex;
  const finishRuleCutIn = useCallback(() => {
    if (activations.length > 0) {
      setLastActivation({
        ruleId: activations.at(-1)!.ruleId,
        name: activations.at(-1)!.name,
        count: activations.length,
        ...(activations.at(-1)!.effectLabel
          ? { effectLabel: activations.at(-1)!.effectLabel }
          : {}),
      });
    }
    // 保持していた場があるときだけ、流れるアニメーションを挟んでから
    // volley を落とす。保持対象はボレーを積んだ時点のプレイへ固定する。
    if (heldPlayedHistoryIndex !== null && !heldPlayWasSuperseded) {
      setIsFlushingField(true);
      return;
    }
    setActivationVolleys((volleys) => volleys.slice(1));
  }, [activations, heldPlayWasSuperseded, heldPlayedHistoryIndex]);
  useEffect(() => {
    if (!isFlushingField) return;
    if (heldPlayWasSuperseded) {
      setIsFlushingField(false);
      setActivationVolleys((volleys) => volleys.slice(1));
      return;
    }
    const timer = window.setTimeout(() => {
      setIsFlushingField(false);
      setActivationVolleys((volleys) => volleys.slice(1));
    }, FIELD_FLUSH_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [heldPlayWasSuperseded, isFlushingField]);
  const openSignOutDialog = () => {
    setSignOutHasSubscription(false);
    setAccountDialog('signOut');
    void pushApi
      .hasActiveSubscription()
      .then(setSignOutHasSubscription)
      .catch(() => undefined);
  };
  const confirmSignOut = () => {
    void pushApi.disableThisDevice().finally(() => {
      client.switchSession(null);
      setAccountDialog(null);
      go('menu');
      setRootToast('サインアウトしました');
    });
  };
  const rootFeedback = (
    <>
      {connectDialog && (
        <ConnectDialog
          displayName={state.displayName}
          connectionReady={state.connection === 'ready'}
          pending={authPending}
          rename={(displayName) => client.rename(displayName)}
          onProceed={() => void beginLogin()}
          onBack={closeConnectDialog}
        />
      )}
      {accountDialog === 'switch' && (
        <ConfirmDialog
          title="別のアカウントにしますか?"
          description={`この端末は、えらんだGoogleアカウントの記録に切り替わります。今の「${state.displayName ?? '—'}」の記録は消えず、また同じGoogleでログインすればもどってきます。`}
          confirmLabel="Googleへ進む"
          cancelLabel={CONFIRM_BACK_LABEL}
          onConfirm={() => {
            setAccountDialog(null);
            void beginLogin();
          }}
          onCancel={() => setAccountDialog(null)}
        />
      )}
      {accountDialog === 'signOut' && (
        <Dialog
          title="サインアウトしますか?"
          onClose={() => setAccountDialog(null)}
          actions={
            <>
              <Button onClick={confirmSignOut}>サインアウトする</Button>
              <Button variant="primary" onClick={() => setAccountDialog(null)}>
                {CONFIRM_BACK_LABEL}
              </Button>
            </>
          }
        >
          <DialogBody>
            この端末から記録が離れて、新しいゲストになります。記録は消えず、またGoogleでログインすればもどってきます。
          </DialogBody>
          {signOutHasSubscription && (
            <DialogBody>この端末のおしらせも届かなくなります。</DialogBody>
          )}
        </Dialog>
      )}
      {authResultDialog?.kind === 'switched' && (
        <Dialog
          title={
            authResultDialog.registeredBefore
              ? '別のアカウントに切り替わりました'
              : `おかえりなさい、${authResultDialog.displayName}さん`
          }
          actions={
            <Button variant="primary" onClick={() => setAuthResultDialog(null)}>
              閉じる
            </Button>
          }
        >
          <DialogBody>
            {authResultDialog.registeredBefore
              ? `今は「${authResultDialog.displayName}」の記録であそんでいます。`
              : `前にあそんだ「${authResultDialog.displayName}」の記録にもどりました。`}
          </DialogBody>
        </Dialog>
      )}
      {authResultDialog?.kind === 'expired' && (
        <Dialog
          title="途中で時間がすぎました"
          actions={
            <>
              <Button
                variant="primary"
                onClick={() => {
                  setAuthResultDialog(null);
                  openConnectDialog(
                    false,
                    playResume === null ? undefined : playResume,
                  );
                }}
              >
                もう一度ためす
              </Button>
              <Button onClick={() => setAuthResultDialog(null)}>閉じる</Button>
            </>
          }
        >
          <DialogBody>もう一度ためせば大丈夫です。</DialogBody>
        </Dialog>
      )}
      {authResultDialog?.kind === 'unavailable' && (
        <Dialog
          title="今はログインできません"
          actions={
            <Button variant="primary" onClick={() => setAuthResultDialog(null)}>
              閉じる
            </Button>
          }
        >
          <DialogBody>時間をおいてから、もう一度ためしてください。</DialogBody>
        </Dialog>
      )}
      {rootToast && (
        <div className={feedbackStyles.toastLayer}>
          <Toast duration={3_000} onDismiss={() => setRootToast(null)}>
            {rootToast}
          </Toast>
        </div>
      )}
    </>
  );
  const show = (content: ReactNode) => (
    <>
      <ConnectionStatus state={state}>{content}</ConnectionStatus>
      <RuleCutIn activations={activations} onDone={finishRuleCutIn} />
      {finalPlayReveal && <FinalPlayReveal {...finalPlayReveal} />}
      {rootFeedback}
    </>
  );
  const visibleSetResultRoom =
    room?.phase === 'setResult'
      ? room
      : !room && isGraduating && graduationFrom?.phase === 'setResult'
        ? graduationFrom
        : null;
  const openRules = (ruleId?: string) => {
    if (!room) return;
    navigate(roomPath(room, 'activeRules', ruleId));
    setRoomOverlay({ kind: 'activeRules', ruleId: ruleId ?? null });
  };
  const closeRules = () => {
    if (!room) return;
    navigate(roomPath(room), 'replace');
    setRoomOverlay(null);
  };
  const backToRules = () => {
    if (!room) return;
    navigate(roomPath(room, 'activeRules'), 'replace');
    setRoomOverlay({ kind: 'activeRules', ruleId: null });
  };
  const cancelLeave = () => {
    setLeaveConfirm(null);
    setLeaveError(null);
  };
  /**
   * 部屋を離れる。playing 中でも席は残り、AI が引きつぐ(E03 §2.4)。
   * 失敗したときはダイアログを開いたまま案内を出す。
   */
  const confirmLeave = () => {
    setLeaveError(null);
    void client.leaveRoom().then(
      () => {
        setLeaveConfirm(null);
        go('menu');
      },
      () => {
        setLeaveError(RETRY_GENERIC_ERROR);
      },
    );
  };
  const leaveDialog =
    leaveConfirm === null ? null : (
      <ConfirmDialog
        title={leaveConfirm === 'waiting' ? LEAVE_ROOM_TITLE : QUIT_GAME_TITLE}
        {...(leaveConfirm === 'game' && room?.mode === 'community'
          ? { description: QUIT_GAME_MULTI_DESCRIPTION }
          : {})}
        confirmLabel={
          leaveConfirm === 'waiting'
            ? LEAVE_ROOM_CONFIRM_LABEL
            : QUIT_GAME_LABEL
        }
        cancelLabel={CONFIRM_BACK_LABEL}
        onConfirm={confirmLeave}
        onCancel={cancelLeave}
        error={leaveError}
      />
    );
  const rulesOverlay =
    room && visibleRoomOverlay?.kind === 'activeRules' ? (
      visibleRoomOverlay.ruleId ? (
        <RuleDetailModal
          api={ruleCatalogApi}
          ruleId={visibleRoomOverlay.ruleId}
          name={
            room.activeRules.find(
              (rule) => rule.ruleId === visibleRoomOverlay.ruleId,
            )?.name ?? 'ルール'
          }
          {...(lastActivation?.ruleId === visibleRoomOverlay.ruleId &&
          lastActivation.effectLabel
            ? { effectLabel: lastActivation.effectLabel }
            : {})}
          onClose={backToRules}
        />
      ) : (
        <ActiveRulesModal
          rules={room.activeRules}
          onSelectRule={openRules}
          onClose={closeRules}
        />
      )
    ) : null;

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

  if (room && visibleRoomOverlay?.kind === 'ruleDex') {
    return show(
      <RuleDexScreen
        api={ruleCatalogApi}
        onBack={() => {
          navigate(roomPath(room, 'activeRules'), 'replace');
          setRoomOverlay({ kind: 'activeRules', ruleId: null });
        }}
      />,
    );
  }

  if (room?.phase === 'waiting') {
    const you = room.members.find(
      (member) => member.memberId === room.you.memberId,
    );
    const inviteUrl = roomInviteUrl(room.inviteCode, window.location.origin);
    return show(
      <>
        <WaitingRoomScreen
          members={waitingMembers(room)}
          inviteCode={room.inviteCode}
          inviteUrl={inviteUrl}
          activeRuleCount={room.activeRules.length}
          onBack={() => {
            setLeaveConfirm('waiting');
          }}
          onViewRules={() => {
            openRules();
          }}
          onStart={() => {
            invoke(client.startRoom());
          }}
          canStart={you?.isHost === true}
          showInvite={room.mode !== 'basic'}
        />
        {rulesOverlay}
        {leaveDialog}
      </>,
    );
  }

  if (room?.phase === 'playing' && room.game?.status === 'playing') {
    const game = room.game;
    const selected = [...selectedCardIds].sort();
    const pendingChoice =
      game.pendingChoice?.seat === room.you.seatId &&
      (game.pendingChoice.kind === 'player'
        ? game.pendingChoice.players !== null
        : game.pendingChoice.cards !== null)
        ? game.pendingChoice
        : null;
    const pendingCardChoice =
      pendingChoice && pendingChoice.kind !== 'player' ? pendingChoice : null;
    const pendingPlayerChoice =
      pendingChoice?.kind === 'player' ? pendingChoice : null;
    const pendingChoicePresentation = pendingChoice
      ? choicePresentation({
          choiceId: pendingChoice.choiceId,
          count: pendingChoice.count,
          message: pendingChoice.message,
          ruleName:
            room.activeRules.find(
              (rule) => rule.ruleId === pendingChoice.ruleId,
            )?.name ?? null,
        })
      : null;
    const choiceCardIds = new Set(
      pendingCardChoice?.cards?.map((card) => card.id) ?? [],
    );
    const legalSelection = pendingCardChoice
      ? selected.length === pendingCardChoice.count &&
        selected.every((id) => choiceCardIds.has(id))
      : pendingPlayerChoice
        ? false
        : (game.legalMoves?.some(
            (move) =>
              move.cards.length === selected.length &&
              move.cards
                .map((card) => card.id)
                .sort()
                .every((id, index) => id === selected[index]),
          ) ?? false);
    const cardHints =
      room.mode === 'basic' && !pendingChoice
        ? deriveCardHints(game.yourHand, game.legalMoves, selectedCardIds)
        : undefined;
    const leadMember = room.members.find(
      (member) => member.seatId === game.field.playedBySeat,
    );
    return show(
      <>
        <GameScreen
          gameLabel={`第${String(game.gameNo)}戦`}
          activeRuleCount={room.activeRules.length}
          seats={tableSeats(room, {
            heldPlayedHistoryIndex: heldPlayWasSuperseded
              ? null
              : heldPlayedHistoryIndex,
          })}
          isFlushing={isFlushingField && !heldPlayWasSuperseded}
          statuses={game.statuses}
          // 場を保持しているあいだは、消えた場スコープの状態も一緒に留める。
          // 保持が解けた瞬間(= 場が流れる瞬間)に札と同じタイミングで吸い込む。
          holdFieldStatuses={
            heldPlayedHistoryIndex !== null &&
            !heldPlayWasSuperseded &&
            !isFlushingField
          }
          finishes={seatFinishes(room)}
          discardNotices={cardDiscardNotices(room)}
          privateRuleNotices={game.privateRuleNotices ?? []}
          leadSeatName={
            leadMember
              ? seatDisplayName(
                  leadMember.displayName,
                  leadMember.memberId === room.you.memberId,
                )
              : null
          }
          activations={[]}
          // リボンが引いた時点で反映を再開する。場流しのあいだ止めたままだと、
          // 場チップの吸い込みが札の流れに乗り遅れる。
          isCutInPlaying={activations.length > 0 && !isFlushingField}
          onCutInDone={finishRuleCutIn}
          lastActivation={activations.length > 0 ? null : lastActivation}
          hand={cards(game.yourHand)}
          selectedCardIds={selectedCardIds}
          {...(cardHints ? { cardHints } : {})}
          guideCue={tutorialEligible ? guideCue : null}
          showStrengthScale={tutorialEligible}
          strengthInverted={game.strengthInverted}
          isMyTurn={game.turn?.seat === room.you.seatId}
          canPlay={legalSelection}
          canPass={!pendingChoice && game.field.cards.length > 0}
          playLabel={
            pendingChoicePresentation?.confirmLabel ?? 'えらんだカードを出す'
          }
          actionRuleName={pendingChoicePresentation?.ruleName ?? null}
          actionPrompt={pendingChoicePresentation?.instruction ?? null}
          turnDeadlineAt={game.turn?.deadlineAt ?? null}
          onViewRules={() => {
            openRules();
          }}
          onOpenActivation={openRules}
          onToggleCard={(id) => {
            if (pendingChoice && !choiceCardIds.has(id)) return;
            setSelectedCardIds((ids) =>
              ids.includes(id)
                ? ids.filter((item) => item !== id)
                : [...ids, id],
            );
          }}
          onPlay={() => {
            if (!game.turn || !legalSelection) return;
            invoke(
              (pendingCardChoice
                ? client.ruleInput(
                    game.turn.turnSeq,
                    pendingCardChoice.choiceId,
                    [...selectedCardIds],
                  )
                : client.play(game.turn.turnSeq, [...selectedCardIds])
              ).then(() => {
                setSelectedCardIds([]);
              }),
            );
          }}
          onPass={() => {
            if (!game.turn) return;
            invoke(client.pass(game.turn.turnSeq));
          }}
          onQuit={() => {
            setLeaveConfirm('game');
          }}
        />
        {pendingPlayerChoice && game.turn && (
          <Dialog
            title={
              room.activeRules.find(
                (rule) => rule.ruleId === pendingPlayerChoice.ruleId,
              )?.name ?? 'ルールの選択'
            }
            actions={(pendingPlayerChoice.players ?? []).map((player) => (
              <Button
                key={player.seat}
                block
                onClick={() => {
                  invoke(
                    client.rulePlayerInput(
                      game.turn?.turnSeq ?? 0,
                      pendingPlayerChoice.choiceId,
                      room.members.find(
                        (member) => member.seatId === player.seat,
                      )?.memberId ?? '',
                    ),
                  );
                }}
              >
                {player.displayName}
              </Button>
            ))}
          >
            <DialogBody>
              {pendingPlayerChoice.message ?? '相手を選んでください'}
            </DialogBody>
          </Dialog>
        )}
        {game.miniGame && (
          <BombThrowMiniGame
            game={game.miniGame}
            yourSeat={room.you.seatId}
            names={Object.fromEntries(
              room.members.flatMap((member) =>
                member.seatId === null
                  ? []
                  : [[member.seatId, member.displayName] as const],
              ),
            )}
            onCommand={(input) => {
              invoke(client.miniGameInput(game.miniGame!.id, input));
            }}
          />
        )}
        {rulesOverlay}
        {leaveDialog}
      </>,
    );
  }

  if (room?.phase === 'playing' && room.game?.status === 'intermission') {
    const nextGame = room.game.gameNo + 1;
    const intermission = room.game.intermission;
    return show(
      <>
        <GameResultScreen
          title={`第${String(room.game.gameNo)}戦 おわり`}
          progressLabel={`セット ${String(room.game.gameNo)} / 3 戦`}
          ranks={gameRanks(room)}
          nextLabel={`第${String(nextGame)}戦へ`}
          autoAdvanceMs={intermission?.durationMs ?? 15_000}
          autoAdvanceAt={intermission?.endsAt ?? Date.now() + 15_000}
          waitingForOthers={intermission?.ready ?? false}
          onNext={() => {
            invoke(client.readyNextGame());
          }}
          onQuit={() => {
            setLeaveConfirm('game');
          }}
        />
        {leaveDialog}
      </>,
    );
  }

  /*
   * セット最終戦だけサーバーは interimResult を挟まない(そのまま setResult へ進む)。
   * その戦の結果をセット総合と一緒に出すと 2 つの結果が混ざるので、
   * この端末の中でだけ最終戦リザルトを先に見せてからセットリザルトへ渡す。
   */
  const finalResultKey =
    room?.phase === 'setResult' &&
    room.you.seatId !== null &&
    room.setResult?.finalGame
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
          waitingForOthers={false}
          onNext={() => {
            setFinalResultSeen(key);
          }}
        />,
      );
    }
  }

  if (visibleSetResultRoom) {
    const resultRoom = visibleSetResultRoom;
    if (resultRoom.you.seatId === null) {
      return show(
        <NextSetWaitingScreen
          onLeave={() => {
            invoke(
              client.leaveRoom().then(() => {
                go('menu');
              }),
            );
          }}
        />,
      );
    }
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
          invoke(
            client.leaveRoom().then(() => {
              go('menu');
              offerMenuPromptAfterCompletedSet();
            }),
          );
        }}
        actionError={evaluationError ?? graduationError}
        showEvaluation
        waitingFor={waitingFor}
        actionPending={isGraduating}
        showSupport={resultRoom.mode !== 'basic'}
      />,
    );
  }

  if (!sharedInviteCode && current === 'title') {
    return show(<TitleScreen onStart={() => go('menu')} />);
  }
  if (!sharedInviteCode && current === 'proposal') {
    return show(
      <ProposalFormScreen
        api={getBrowserProposalClient()}
        onBack={() => go('menu')}
        registered={state.registered}
        onLogin={() => openConnectDialog()}
        onOpenMyProposals={() => go('myProposals')}
        notification={notificationBell}
        pushOffer={{
          offer: () => pushApi.offer(),
          subscribe: () => pushApi.subscribeProposalResults(),
          decline: () => pushApi.declineOffer(),
        }}
        pushRegistration={{
          declined: () => pushApi.offerDeclined(),
          begin: beginPushLogin,
        }}
      />,
    );
  }
  if (!sharedInviteCode && current === 'account') {
    return show(
      <AccountScreen
        api={proposalApi}
        displayName={state.displayName}
        registered={state.registered}
        connection={state.connection}
        onBack={() => go('menu')}
        onRename={() => go('name')}
        onOpenProposals={() => go('myProposals')}
        onConnect={() => openConnectDialog()}
        onSwitch={() => setAccountDialog('switch')}
        onSignOut={openSignOutDialog}
      />,
    );
  }
  if (!sharedInviteCode && current === 'name') {
    return show(
      <NameScreen
        displayName={state.displayName}
        connection={state.connection}
        rename={(displayName) => client.rename(displayName)}
        onBack={() => go('account')}
      />,
    );
  }
  if (!sharedInviteCode && current === 'myProposals') {
    return show(
      <MyProposalsScreen
        api={proposalApi}
        onBack={() => go('menu')}
        onUnreadCountChange={setUnreadProposalCount}
        notification={notificationBell}
      />,
    );
  }
  if (!sharedInviteCode && current === 'notifications') {
    return show(
      <NotificationsScreen
        api={notificationApi}
        onBack={() => go('menu')}
        onSettings={() => go('pushSettings')}
        onUnreadCountChange={(count) =>
          client.setUnreadNotificationCount(count)
        }
        onOpen={(item: NotificationView) => {
          navigate(item.url);
          useScreenStore.setState({
            current: screenFromPathname(
              new URL(item.url, window.location.origin).pathname,
            ),
          });
        }}
      />,
    );
  }
  if (!sharedInviteCode && current === 'ruleBalanceNotice') {
    return show(
      <RuleBalanceNoticeScreen
        releasedOn={new URLSearchParams(window.location.search).get('released')}
        onBack={() => go('notifications')}
      />,
    );
  }
  if (!sharedInviteCode && current === 'pushSettings') {
    return show(
      <PushSettingsScreen
        api={pushApi}
        onBack={() => go('notifications')}
        registered={state.registered}
        onLogin={beginPushLogin}
      />,
    );
  }
  if (!sharedInviteCode && current === 'ruleDex') {
    return show(
      <RuleDexScreen
        api={ruleCatalogApi}
        onBack={() => go('menu')}
        notification={notificationBell}
        initialRuleId={new URLSearchParams(window.location.search).get('rule')}
      />,
    );
  }
  return show(
    <>
      <MenuScreen
        onPlay={() => {
          setPlayResume(null);
          setPlaySheetError(null);
          setJoinSeatChoice(null);
          setIsChoosingRoom(true);
        }}
        onPropose={() => go('proposal')}
        onEncyclopedia={() => go('ruleDex')}
        onMyProposals={() => go('myProposals')}
        displayName={state.displayName}
        accountState={
          state.connection !== 'ready'
            ? 'connecting'
            : authPending
              ? 'pending'
              : state.registered
                ? 'registered'
                : 'anonymous'
        }
        onOpenAccount={() => go('account')}
        showConnectPrompt={showMenuConnectPrompt && !state.registered}
        onConnect={() => openConnectDialog()}
        onConnectPromptShown={markMenuPromptShown}
        unreadProposalCount={unreadProposalCount}
        notification={notificationBell}
      />
      {isChoosingRoom && (
        <PlaySheet
          {...(!state.registered
            ? { anonymousDisplayName: state.displayName }
            : {})}
          {...(sharedInviteCode || playResume?.kind === 'join'
            ? {
                initialInviteCode:
                  sharedInviteCode ??
                  (playResume?.kind === 'join' ? playResume.inviteCode : ''),
              }
            : {})}
          {...(playResume ? { initialStep: playResume.kind } : {})}
          initialMode={playSheetError === GRADUATION_ERROR ? 'community' : null}
          seatOptions={joinSeatChoice?.seats ?? null}
          takeoverPendingMemberId={takeoverPendingMemberId}
          onLogin={(resume) => {
            setPlayResume(resume);
            openConnectDialog(false, resume);
          }}
          onCreate={(mode, displayName) => {
            setPlaySheetError(null);
            setJoinSeatChoice(null);
            const renameBeforeCreate =
              !state.registered &&
              displayName !== undefined &&
              displayName !== state.displayName
                ? client.rename(displayName)
                : Promise.resolve();
            void renameBeforeCreate
              .then(() => client.createRoom(mode))
              .then(() => {
                setPlayResume(null);
                setIsChoosingRoom(false);
                // ひとりで練習する部屋は待つ相手がいないので待機室を挟まない。
                // 開始に失敗したらそのまま待機室に残す。部屋の主は自分ひとりで、
                // 目の前の「はじめる」を押せばやり直せるため、専用の文言は出さない。
                if (mode === 'basic') invoke(client.startRoom());
              })
              .catch(() => {
                setPlaySheetError(RETRY_GENERIC_ERROR);
              });
          }}
          onJoin={(inviteCode, displayName) => {
            setPlaySheetError(null);
            const renameBeforeJoin =
              !state.registered &&
              displayName !== undefined &&
              displayName !== state.displayName
                ? client.rename(displayName)
                : Promise.resolve();
            void renameBeforeJoin
              .then(() => client.joinRoom(inviteCode))
              .then(() => {
                setPlayResume(null);
                setIsChoosingRoom(false);
              })
              .catch((error: unknown) => {
                if (
                  !(error instanceof Error) ||
                  error.message !== 'SEAT_CHOICE_REQUIRED'
                ) {
                  return;
                }
                void client
                  .seatOptions(inviteCode)
                  .then((result) => {
                    setJoinSeatChoice({ inviteCode, seats: result.seats });
                    setPlaySheetError(null);
                  })
                  .catch(() => undefined);
              });
          }}
          onTakeover={(memberId) => {
            if (!joinSeatChoice || takeoverPendingMemberId !== null) return;
            const { inviteCode } = joinSeatChoice;
            setTakeoverPendingMemberId(memberId);
            setPlaySheetError(null);
            void client
              .joinRoom(inviteCode, memberId)
              .then(() => {
                setJoinSeatChoice(null);
                setPlayResume(null);
                setIsChoosingRoom(false);
              })
              .catch(async (error: unknown) => {
                if (
                  !(error instanceof Error) ||
                  error.message !== 'SEAT_TAKEN'
                ) {
                  return;
                }
                try {
                  await client.joinRoom(inviteCode);
                  setJoinSeatChoice(null);
                  setPlayResume(null);
                  setIsChoosingRoom(false);
                } catch (retryError: unknown) {
                  if (
                    !(retryError instanceof Error) ||
                    retryError.message !== 'SEAT_CHOICE_REQUIRED'
                  ) {
                    return;
                  }
                  const result = await client.seatOptions(inviteCode);
                  setJoinSeatChoice({ inviteCode, seats: result.seats });
                  setPlaySheetError('その席は埋まりました');
                }
              })
              .finally(() => {
                setTakeoverPendingMemberId(null);
              })
              .catch(() => undefined);
          }}
          onBackFromSeatChoice={() => {
            setJoinSeatChoice(null);
            setPlaySheetError(null);
          }}
          onClose={() => {
            setPlayResume(null);
            safeSessionRemove(AUTH_PLAY_RESUME_KEY);
            setIsChoosingRoom(false);
            setPlaySheetError(null);
            setJoinSeatChoice(null);
            setTakeoverPendingMemberId(null);
            if (sharedInviteCode) {
              navigate('/menu', 'replace');
            }
          }}
          error={playSheetError ?? friendlyError(state.error)}
        />
      )}
      {menuPushOfferKind && (
        <PushOfferDialog
          kind={menuPushOfferKind}
          subscribe={() => pushApi.subscribeProposalResults()}
          decline={() => pushApi.declineOffer()}
          onClose={() => setMenuPushOfferKind(null)}
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
      SEAT_CHOICE_REQUIRED:
        'この部屋は対戦中です。空いている席をえらんでください',
      SEAT_TAKEN: 'その席は埋まりました',
      ROOM_SOLO_ONLY:
        'この部屋はひとりで練習する部屋です。友だちの部屋の招待コードをたしかめてください。',
      RATE_LIMITED: 'しばらく待ってから、もう一度ためしてください',
    }[error] ?? '操作に失敗しました。もう一度ためしてください'
  );
}

export function App({
  client,
  storage,
  evaluationApi,
  auth,
  push,
}: {
  client?: MultiplayerClient | null;
  storage?: PlayedBeforeStorage;
  evaluationApi?: EvaluationApi;
  auth?: AuthApi;
  push?: PushClient;
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
          begin: () => {
            return Promise.reject(new Error('auth_unavailable'));
          },
          complete: () => {
            return Promise.reject(new Error('auth_unavailable'));
          },
        }
      : getBrowserAuthClient());
  const effectivePush = push ?? getBrowserPushClient();
  return effectiveClient ? (
    <ConnectedApp
      client={effectiveClient}
      storage={effectiveStorage}
      evaluationApi={effectiveEvaluationApi}
      auth={effectiveAuth}
      pushApi={effectivePush}
    />
  ) : (
    <DemoApp />
  );
}
