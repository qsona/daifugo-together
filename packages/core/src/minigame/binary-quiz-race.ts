import type { PlayerId } from '../game/types.js';

export type BinaryQuizOption = 'a' | 'b';
export type BinaryQuizPhase =
  'awaitingQuestion' | 'answering' | 'reveal' | 'result';

export interface BinaryQuizQuestion {
  id: string;
  prompt: string;
  options: readonly [{ id: 'a'; label: string }, { id: 'b'; label: string }];
  correctOption: BinaryQuizOption;
}

export interface BinaryQuizRoundResult {
  round: number;
  questionId: string;
  correctOption: BinaryQuizOption;
  answers: Record<PlayerId, BinaryQuizOption>;
  correctPlayerIds: PlayerId[];
}

export interface BinaryQuizRaceState {
  id: string;
  kind: 'binary_quiz_race';
  seed: string;
  participants: PlayerId[];
  questionSet: string;
  defaultOption: BinaryQuizOption;
  roundDurationMs: number;
  targetScore: number;
  maxRounds: number;
  phase: BinaryQuizPhase;
  elapsedMs: number;
  phaseElapsedMs: number;
  round: number;
  usedQuestionIds: string[];
  question?: BinaryQuizQuestion;
  answers: Record<PlayerId, BinaryQuizOption>;
  scores: Record<PlayerId, number>;
  lastRound?: BinaryQuizRoundResult;
  winnerPlayerIds?: PlayerId[];
}

export interface BinaryQuizRaceResult {
  miniGameId: string;
  winnerPlayerIds: PlayerId[];
  scores: Record<PlayerId, { score: number }>;
}

export const BINARY_QUIZ_TICK_MS = 200;
export const BINARY_QUIZ_REVEAL_MS = 1_000;
export const BINARY_QUIZ_RESULT_MS = 1_000;

function hash(value: string): number {
  let result = 2_166_136_261;
  for (const character of value) {
    result ^= character.codePointAt(0) ?? 0;
    result = Math.imul(result, 16_777_619);
  }
  return result >>> 0;
}

function distinctParticipants(participants: readonly PlayerId[]): PlayerId[] {
  return [...new Set(participants)].slice(0, 4);
}

export function binaryQuizQuestionValid(
  question: unknown,
): question is BinaryQuizQuestion {
  if (typeof question !== 'object' || question === null) return false;
  const value = question as Record<string, unknown>;
  if (
    Object.keys(value).sort().join(',') !== 'correctOption,id,options,prompt' ||
    typeof value.id !== 'string' ||
    !/^[a-z0-9]+(?:_[a-z0-9]+)*$/u.test(value.id) ||
    value.id.length > 64 ||
    typeof value.prompt !== 'string' ||
    value.prompt.trim().length === 0 ||
    [...value.prompt].length > 120 ||
    !Array.isArray(value.options) ||
    value.options.length !== 2 ||
    (value.correctOption !== 'a' && value.correctOption !== 'b')
  ) {
    return false;
  }
  return value.options.every((option, index) => {
    if (typeof option !== 'object' || option === null) return false;
    const entry = option as Record<string, unknown>;
    const expected = index === 0 ? 'a' : 'b';
    return (
      Object.keys(entry).sort().join(',') === 'id,label' &&
      entry.id === expected &&
      typeof entry.label === 'string' &&
      entry.label.trim().length > 0 &&
      [...entry.label].length <= 60
    );
  });
}

export function createBinaryQuizRace(input: {
  id: string;
  seed: string;
  participants: readonly PlayerId[];
  questionSet: string;
  defaultOption: BinaryQuizOption;
  roundDurationMs: number;
  targetScore: number;
  maxRounds: number;
}): BinaryQuizRaceState {
  const participants = distinctParticipants(input.participants);
  return {
    id: input.id,
    kind: 'binary_quiz_race',
    seed: input.seed,
    participants,
    questionSet: input.questionSet,
    defaultOption: input.defaultOption,
    roundDurationMs: input.roundDurationMs,
    targetScore: input.targetScore,
    maxRounds: input.maxRounds,
    phase: 'awaitingQuestion',
    elapsedMs: 0,
    phaseElapsedMs: 0,
    round: 1,
    usedQuestionIds: [],
    answers: {},
    scores: Object.fromEntries(participants.map((player) => [player, 0])),
  };
}

export function setBinaryQuizQuestion(
  state: BinaryQuizRaceState,
  input: { round: number; question: BinaryQuizQuestion },
): BinaryQuizRaceState {
  if (
    state.phase !== 'awaitingQuestion' ||
    input.round !== state.round ||
    !binaryQuizQuestionValid(input.question) ||
    state.usedQuestionIds.includes(input.question.id)
  ) {
    return state;
  }
  return {
    ...state,
    phase: 'answering',
    phaseElapsedMs: 0,
    question: structuredClone(input.question),
    answers: {},
    usedQuestionIds: [...state.usedQuestionIds, input.question.id],
  };
}

export function canAnswerBinaryQuiz(
  state: BinaryQuizRaceState,
  input: {
    playerId: PlayerId;
    round: number;
    option: BinaryQuizOption;
  },
): boolean {
  return (
    state.phase === 'answering' &&
    input.round === state.round &&
    state.participants.includes(input.playerId) &&
    state.answers[input.playerId] === undefined &&
    (input.option === 'a' || input.option === 'b')
  );
}

export function answerBinaryQuiz(
  state: BinaryQuizRaceState,
  input: {
    playerId: PlayerId;
    round: number;
    option: BinaryQuizOption;
  },
): BinaryQuizRaceState {
  if (!canAnswerBinaryQuiz(state, input)) return state;
  return {
    ...state,
    answers: { ...state.answers, [input.playerId]: input.option },
  };
}

function automatedOption(
  state: BinaryQuizRaceState,
  playerId: PlayerId,
): BinaryQuizOption {
  return hash(`${state.seed}:${String(state.round)}:${playerId}`) % 2 === 0
    ? 'a'
    : 'b';
}

function finishAnswering(state: BinaryQuizRaceState): BinaryQuizRaceState {
  const question = state.question;
  if (!question) return state;
  const answers = Object.fromEntries(
    state.participants.map((playerId) => [
      playerId,
      state.answers[playerId] ?? state.defaultOption,
    ]),
  ) as Record<PlayerId, BinaryQuizOption>;
  const correctPlayerIds = state.participants.filter(
    (playerId) => answers[playerId] === question.correctOption,
  );
  const scores = { ...state.scores };
  for (const playerId of correctPlayerIds) {
    scores[playerId] = (scores[playerId] ?? 0) + 1;
  }
  const targetWinners = state.participants.filter(
    (playerId) => (scores[playerId] ?? 0) >= state.targetScore,
  );
  const maxScore = Math.max(...state.participants.map((id) => scores[id] ?? 0));
  const cappedWinners =
    state.round >= state.maxRounds
      ? state.participants.filter((id) => (scores[id] ?? 0) === maxScore)
      : [];
  const winnerPlayerIds =
    targetWinners.length > 0 ? targetWinners : cappedWinners;
  return {
    ...state,
    phase: 'reveal',
    phaseElapsedMs: 0,
    answers,
    scores,
    lastRound: {
      round: state.round,
      questionId: question.id,
      correctOption: question.correctOption,
      answers,
      correctPlayerIds,
    },
    ...(winnerPlayerIds.length > 0 ? { winnerPlayerIds } : {}),
  };
}

export function advanceBinaryQuizRace(
  state: BinaryQuizRaceState,
  input: { deltaMs?: number; automatedPlayerIds?: readonly PlayerId[] } = {},
): BinaryQuizRaceState {
  if (binaryQuizRaceComplete(state) || state.phase === 'awaitingQuestion') {
    return state;
  }
  const deltaMs = Math.max(1, input.deltaMs ?? BINARY_QUIZ_TICK_MS);
  let next: BinaryQuizRaceState = {
    ...state,
    elapsedMs: state.elapsedMs + deltaMs,
    phaseElapsedMs: state.phaseElapsedMs + deltaMs,
  };
  if (next.phase === 'answering') {
    for (const playerId of [...(input.automatedPlayerIds ?? [])].sort()) {
      next = answerBinaryQuiz(next, {
        playerId,
        round: next.round,
        option: automatedOption(next, playerId),
      });
    }
    return next.phaseElapsedMs >= next.roundDurationMs
      ? finishAnswering(next)
      : next;
  }
  if (next.phase === 'reveal' && next.phaseElapsedMs >= BINARY_QUIZ_REVEAL_MS) {
    if ((next.winnerPlayerIds?.length ?? 0) > 0) {
      return { ...next, phase: 'result', phaseElapsedMs: 0 };
    }
    const withoutQuestion = { ...next };
    delete withoutQuestion.question;
    return {
      ...withoutQuestion,
      phase: 'awaitingQuestion',
      phaseElapsedMs: 0,
      round: next.round + 1,
      answers: {},
    };
  }
  return next;
}

export function binaryQuizRaceComplete(state: BinaryQuizRaceState): boolean {
  return (
    state.phase === 'result' && state.phaseElapsedMs >= BINARY_QUIZ_RESULT_MS
  );
}

export function binaryQuizRaceResult(
  state: BinaryQuizRaceState,
): BinaryQuizRaceResult {
  return {
    miniGameId: state.id,
    winnerPlayerIds: [...(state.winnerPlayerIds ?? [])],
    scores: Object.fromEntries(
      state.participants.map((playerId) => [
        playerId,
        { score: state.scores[playerId] ?? 0 },
      ]),
    ),
  };
}
