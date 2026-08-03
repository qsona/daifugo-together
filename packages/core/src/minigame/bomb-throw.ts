import type { PlayerId } from '../game/types.js';

export type BombThrowDirection = 'up' | 'down' | 'left' | 'right' | 'stop';
export type BombThrowPhase = 'countdown' | 'playing' | 'result';

export interface BombThrowPlayerState {
  playerId: PlayerId;
  x: number;
  y: number;
  direction: BombThrowDirection;
  throwQueued: boolean;
  score: number;
  hitsTaken: number;
  invulnerableUntilMs: number;
  lastBombAtMs: number;
}

export interface BombThrowBombState {
  id: string;
  ownerPlayerId: PlayerId;
  x: number;
  y: number;
  explodeAtMs: number;
}

export interface BombThrowBlastState {
  x: number;
  y: number;
  ownerPlayerId: PlayerId;
  expiresAtMs: number;
}

export interface BombThrowMiniGameState {
  id: string;
  kind: 'bomb_throw_15';
  seed: string;
  phase: BombThrowPhase;
  elapsedMs: number;
  durationMs: number;
  width: number;
  height: number;
  obstacles: { x: number; y: number }[];
  players: Record<PlayerId, BombThrowPlayerState>;
  bombs: BombThrowBombState[];
  blasts: BombThrowBlastState[];
  nextBombNo: number;
  winnerPlayerId?: PlayerId;
}

export interface BombThrowResult {
  miniGameId: string;
  winnerPlayerId: PlayerId;
  scores: Record<PlayerId, { score: number; hitsTaken: number }>;
}

export const BOMB_THROW_COUNTDOWN_MS = 2_000;
export const BOMB_THROW_PLAY_MS = 12_000;
export const BOMB_THROW_RESULT_MS = 1_000;
export const BOMB_THROW_TICK_MS = 200;

const BOMB_FUSE_MS = 1_000;
const BOMB_COOLDOWN_MS = 1_400;
const INVULNERABILITY_MS = 700;
const BLAST_VISIBLE_MS = 400;
const BLAST_RADIUS = 2;
const THROW_RANGE = 3;
const HAZARD_START_MS = BOMB_THROW_PLAY_MS - 4_000;

const DIRECTIONS = ['up', 'right', 'down', 'left'] as const;
const DELTA: Record<
  Exclude<BombThrowDirection, 'stop'>,
  { x: number; y: number }
> = {
  up: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

function hash(value: string): number {
  let result = 2_166_136_261;
  for (const character of value) {
    result ^= character.codePointAt(0) ?? 0;
    result = Math.imul(result, 16_777_619);
  }
  return result >>> 0;
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function isBlocked(
  state: BombThrowMiniGameState,
  x: number,
  y: number,
): boolean {
  return (
    x < 0 ||
    y < 0 ||
    x >= state.width ||
    y >= state.height ||
    state.obstacles.some((cell) => cell.x === x && cell.y === y)
  );
}

export function createBombThrowMiniGame(input: {
  id: string;
  seed: string;
  participants: readonly PlayerId[];
  durationMs?: number;
}): BombThrowMiniGameState {
  const width = 7;
  const height = 7;
  const spawnPoints = [
    { x: 0, y: 0, direction: 'right' as const },
    { x: 6, y: 6, direction: 'left' as const },
    { x: 6, y: 0, direction: 'down' as const },
    { x: 0, y: 6, direction: 'up' as const },
  ];
  const participants = [...new Set(input.participants)].slice(0, 4);
  return {
    id: input.id,
    kind: 'bomb_throw_15',
    seed: input.seed,
    phase: 'countdown',
    elapsedMs: 0,
    durationMs: input.durationMs ?? BOMB_THROW_PLAY_MS,
    width,
    height,
    obstacles: [
      { x: 1, y: 3 },
      { x: 3, y: 1 },
      { x: 3, y: 3 },
      { x: 3, y: 5 },
      { x: 5, y: 3 },
    ],
    players: Object.fromEntries(
      participants.map((playerId, index) => {
        const spawn = spawnPoints[index] ?? spawnPoints[0]!;
        return [
          playerId,
          {
            playerId,
            x: spawn.x,
            y: spawn.y,
            direction: spawn.direction,
            throwQueued: false,
            score: 0,
            hitsTaken: 0,
            invulnerableUntilMs: 0,
            lastBombAtMs: -BOMB_COOLDOWN_MS,
          },
        ];
      }),
    ),
    bombs: [],
    blasts: [],
    nextBombNo: 1,
  };
}

export function applyBombThrowCommand(
  state: BombThrowMiniGameState,
  input: {
    playerId: PlayerId;
    direction?: BombThrowDirection;
    throwBomb?: boolean;
  },
): BombThrowMiniGameState {
  const player = state.players[input.playerId];
  if (!player || state.phase === 'result') {
    return state;
  }
  return {
    ...state,
    players: {
      ...state.players,
      [input.playerId]: {
        ...player,
        ...(input.direction === undefined
          ? {}
          : { direction: input.direction }),
        throwQueued: player.throwQueued || input.throwBomb === true,
      },
    },
  };
}

function movePlayers(state: BombThrowMiniGameState): BombThrowMiniGameState {
  const occupied = new Set<string>();
  const originalOccupants = new Map(
    Object.values(state.players).map((player) => [
      cellKey(player.x, player.y),
      player.playerId,
    ]),
  );
  const players: Record<PlayerId, BombThrowPlayerState> = {};
  for (const player of Object.values(state.players).sort((a, b) =>
    a.playerId.localeCompare(b.playerId),
  )) {
    const delta = player.direction === 'stop' ? null : DELTA[player.direction];
    const nextX = delta ? player.x + delta.x : player.x;
    const nextY = delta ? player.y + delta.y : player.y;
    const nextKey = cellKey(nextX, nextY);
    const canMove =
      delta !== null &&
      !isBlocked(state, nextX, nextY) &&
      !(
        originalOccupants.has(nextKey) &&
        originalOccupants.get(nextKey) !== player.playerId
      ) &&
      !occupied.has(nextKey) &&
      !state.bombs.some((bomb) => bomb.x === nextX && bomb.y === nextY);
    const moved = canMove ? { ...player, x: nextX, y: nextY } : player;
    occupied.add(cellKey(moved.x, moved.y));
    players[player.playerId] = moved;
  }
  return { ...state, players };
}

function landBomb(
  state: BombThrowMiniGameState,
  player: BombThrowPlayerState,
): { x: number; y: number } {
  const direction = player.direction === 'stop' ? 'up' : player.direction;
  const delta = DELTA[direction];
  let x = player.x;
  let y = player.y;
  for (let distance = 0; distance < THROW_RANGE; distance += 1) {
    const nextX = x + delta.x;
    const nextY = y + delta.y;
    if (isBlocked(state, nextX, nextY)) {
      break;
    }
    x = nextX;
    y = nextY;
  }
  return { x, y };
}

function placeQueuedBombs(
  state: BombThrowMiniGameState,
): BombThrowMiniGameState {
  let nextBombNo = state.nextBombNo;
  const bombs = [...state.bombs];
  const players = Object.fromEntries(
    Object.values(state.players).map((player) => {
      const mayThrow =
        player.throwQueued &&
        state.elapsedMs - player.lastBombAtMs >= BOMB_COOLDOWN_MS &&
        !bombs.some((bomb) => bomb.ownerPlayerId === player.playerId);
      if (!mayThrow) {
        return [player.playerId, { ...player, throwQueued: false }];
      }
      const landing = landBomb(state, player);
      bombs.push({
        id: `${state.id}_b${nextBombNo}`,
        ownerPlayerId: player.playerId,
        ...landing,
        explodeAtMs: state.elapsedMs + BOMB_FUSE_MS,
      });
      nextBombNo += 1;
      return [
        player.playerId,
        { ...player, throwQueued: false, lastBombAtMs: state.elapsedMs },
      ];
    }),
  );
  return { ...state, players, bombs, nextBombNo };
}

function blastCells(
  state: BombThrowMiniGameState,
  bomb: BombThrowBombState,
): { x: number; y: number }[] {
  const cells = [{ x: bomb.x, y: bomb.y }];
  for (const direction of DIRECTIONS) {
    const delta = DELTA[direction];
    for (let distance = 1; distance <= BLAST_RADIUS; distance += 1) {
      const x = bomb.x + delta.x * distance;
      const y = bomb.y + delta.y * distance;
      if (isBlocked(state, x, y)) {
        break;
      }
      cells.push({ x, y });
    }
  }
  return cells;
}

function explodeBombs(state: BombThrowMiniGameState): BombThrowMiniGameState {
  const pending = [...state.bombs];
  const exploding = new Map<string, BombThrowBombState>();
  const first = pending.filter((bomb) => bomb.explodeAtMs <= state.elapsedMs);
  for (const bomb of first) {
    exploding.set(bomb.id, bomb);
  }
  let changed = true;
  while (changed) {
    changed = false;
    const cells = new Set(
      [...exploding.values()]
        .flatMap((bomb) => blastCells(state, bomb))
        .map((cell) => cellKey(cell.x, cell.y)),
    );
    for (const bomb of pending) {
      if (!exploding.has(bomb.id) && cells.has(cellKey(bomb.x, bomb.y))) {
        exploding.set(bomb.id, bomb);
        changed = true;
      }
    }
  }
  if (exploding.size === 0) {
    return {
      ...state,
      blasts: state.blasts.filter(
        (blast) => blast.expiresAtMs > state.elapsedMs,
      ),
    };
  }
  const blasts = [
    ...state.blasts.filter((blast) => blast.expiresAtMs > state.elapsedMs),
  ];
  for (const bomb of exploding.values()) {
    for (const cell of blastCells(state, bomb)) {
      blasts.push({
        ...cell,
        ownerPlayerId: bomb.ownerPlayerId,
        expiresAtMs: state.elapsedMs + BLAST_VISIBLE_MS,
      });
    }
  }
  const players = { ...state.players };
  for (const target of Object.values(players)) {
    if (target.invulnerableUntilMs > state.elapsedMs) {
      continue;
    }
    const hit = blasts.find(
      (blast) =>
        blast.x === target.x &&
        blast.y === target.y &&
        blast.ownerPlayerId !== target.playerId,
    );
    if (!hit) {
      continue;
    }
    players[target.playerId] = {
      ...target,
      hitsTaken: target.hitsTaken + 1,
      invulnerableUntilMs: state.elapsedMs + INVULNERABILITY_MS,
    };
    const attacker = players[hit.ownerPlayerId];
    if (attacker) {
      players[hit.ownerPlayerId] = { ...attacker, score: attacker.score + 1 };
    }
  }
  return {
    ...state,
    players,
    bombs: state.bombs.filter((bomb) => !exploding.has(bomb.id)),
    blasts,
  };
}

function applyOuterHazard(
  state: BombThrowMiniGameState,
): BombThrowMiniGameState {
  const playElapsed = state.elapsedMs - BOMB_THROW_COUNTDOWN_MS;
  if (playElapsed < HAZARD_START_MS) {
    return state;
  }
  const players = { ...state.players };
  for (const player of Object.values(players)) {
    const onEdge =
      player.x === 0 ||
      player.y === 0 ||
      player.x === state.width - 1 ||
      player.y === state.height - 1;
    if (!onEdge || player.invulnerableUntilMs > state.elapsedMs) {
      continue;
    }
    players[player.playerId] = {
      ...player,
      hitsTaken: player.hitsTaken + 1,
      invulnerableUntilMs: state.elapsedMs + INVULNERABILITY_MS,
    };
  }
  return { ...state, players };
}

function chooseWinner(state: BombThrowMiniGameState): PlayerId {
  return Object.values(state.players).sort(
    (a, b) =>
      b.score - a.score ||
      a.hitsTaken - b.hitsTaken ||
      hash(`${state.seed}:${a.playerId}`) -
        hash(`${state.seed}:${b.playerId}`) ||
      a.playerId.localeCompare(b.playerId),
  )[0]!.playerId;
}

function automatePlayers(
  state: BombThrowMiniGameState,
  automatedPlayers: ReadonlySet<PlayerId>,
): BombThrowMiniGameState {
  let next = state;
  const tick = Math.floor(state.elapsedMs / BOMB_THROW_TICK_MS);
  for (const playerId of [...automatedPlayers].sort()) {
    const player = next.players[playerId];
    if (!player) {
      continue;
    }
    const opponents = Object.values(next.players).filter(
      (candidate) => candidate.playerId !== playerId,
    );
    const target = opponents.sort(
      (a, b) =>
        Math.abs(a.x - player.x) +
        Math.abs(a.y - player.y) -
        (Math.abs(b.x - player.x) + Math.abs(b.y - player.y)),
    )[0];
    let direction: BombThrowDirection =
      DIRECTIONS[
        hash(`${next.seed}:${playerId}:${Math.floor(tick / 5)}`) %
          DIRECTIONS.length
      ]!;
    if (target && tick % 5 !== 0) {
      direction =
        Math.abs(target.x - player.x) >= Math.abs(target.y - player.y)
          ? target.x >= player.x
            ? 'right'
            : 'left'
          : target.y >= player.y
            ? 'down'
            : 'up';
    }
    next = applyBombThrowCommand(next, {
      playerId,
      direction,
      throwBomb: tick % 7 === hash(`${next.seed}:${playerId}`) % 7,
    });
  }
  return next;
}

export function advanceBombThrowMiniGame(
  state: BombThrowMiniGameState,
  input: { deltaMs?: number; automatedPlayerIds?: readonly PlayerId[] } = {},
): BombThrowMiniGameState {
  if (
    state.phase === 'result' &&
    state.elapsedMs >=
      BOMB_THROW_COUNTDOWN_MS + state.durationMs + BOMB_THROW_RESULT_MS
  ) {
    return state;
  }
  const elapsedMs =
    state.elapsedMs + Math.max(1, input.deltaMs ?? BOMB_THROW_TICK_MS);
  let next: BombThrowMiniGameState = {
    ...state,
    elapsedMs,
    phase:
      elapsedMs < BOMB_THROW_COUNTDOWN_MS
        ? 'countdown'
        : elapsedMs < BOMB_THROW_COUNTDOWN_MS + state.durationMs
          ? 'playing'
          : 'result',
  };
  if (next.phase === 'playing') {
    next = automatePlayers(next, new Set(input.automatedPlayerIds ?? []));
    next = movePlayers(next);
    next = placeQueuedBombs(next);
    next = explodeBombs(next);
    next = applyOuterHazard(next);
  }
  if (next.phase === 'result' && !next.winnerPlayerId) {
    next = { ...next, winnerPlayerId: chooseWinner(next) };
  }
  return next;
}

export function bombThrowComplete(state: BombThrowMiniGameState): boolean {
  return (
    state.phase === 'result' &&
    state.elapsedMs >=
      BOMB_THROW_COUNTDOWN_MS + state.durationMs + BOMB_THROW_RESULT_MS
  );
}

export function bombThrowResult(
  state: BombThrowMiniGameState,
): BombThrowResult {
  const winnerPlayerId = state.winnerPlayerId ?? chooseWinner(state);
  return {
    miniGameId: state.id,
    winnerPlayerId,
    scores: Object.fromEntries(
      Object.values(state.players).map((player) => [
        player.playerId,
        { score: player.score, hitsTaken: player.hitsTaken },
      ]),
    ),
  };
}
