import { matchPatterns } from '../injection/patterns.js';
import type { InjectionRepository } from '../injection/repository.js';
import type { ProposalRepository } from '../proposal/repository.js';
import {
  JUDGEMENT_VERDICTS,
  PipelineRepository,
  REJECT_CATEGORIES,
  type JudgementVerdict,
  type RejectCategory,
  type RuleScaffoldMeta,
  type RuleSpecification,
  type StoredJudgement,
} from './repository.js';

const HOOKS = new Set([
  'modifyLegality',
  'modifyStrength',
  'afterPlay',
  'afterFieldClear',
  'onGameStart',
  'onGameEnd',
]);
const EFFECTS = new Set([
  'clearField',
  'skipTurns',
  'reverseTurnOrder',
  'forceRank',
  'moveCards',
  'setMemory',
  'announce',
]);
const EFFECTS_BY_HOOK: Readonly<Record<string, ReadonlySet<string>>> = {
  modifyLegality: new Set(),
  modifyStrength: new Set(),
  afterPlay: EFFECTS,
  afterFieldClear: new Set([
    'skipTurns',
    'reverseTurnOrder',
    'forceRank',
    'moveCards',
    'setMemory',
    'announce',
  ]),
  onGameStart: new Set([
    'skipTurns',
    'reverseTurnOrder',
    'forceRank',
    'moveCards',
    'setMemory',
    'announce',
  ]),
  onGameEnd: new Set(['setMemory', 'announce']),
};
const REJECT_SUBTYPES = new Set([
  'A1',
  'A2',
  'A3',
  'A4',
  'B1',
  'B2',
  'B3',
  'B4',
  'B5',
  'C1',
  'C2',
  'C3',
]);
const CATEGORY_SUBTYPES: Record<RejectCategory, ReadonlySet<string>> = {
  contract: new Set(['A1', 'A2', 'A3', 'A4']),
  game_breaking: new Set(['B1', 'B2', 'B3', 'B4', 'B5']),
  inappropriate: new Set(['C1']),
  duplicate: new Set(['C2']),
  unintelligible: new Set(['C3']),
  other: new Set(),
};

type JsonObject = Record<string, unknown>;

export interface AiJudgementResult {
  verdict: JudgementVerdict;
  rejectCategory: RejectCategory | null;
  rejectSubtype: string | null;
  reasonForUser: string | null;
  reasonInternal: string;
  spec: Omit<RuleSpecification, 'source'> | null;
  scaffoldMeta: RuleScaffoldMeta | null;
  confidence: number;
  model: string;
  promptVersion: string;
  latencyMs: number;
}

export type PipelineMutationResult =
  | { status: 'recorded'; judgement: StoredJudgement }
  | { status: 'already_recorded'; judgement: StoredJudgement }
  | { status: 'confirmed'; judgement: StoredJudgement; jobId?: number }
  | { status: 'already_confirmed'; judgement: StoredJudgement; jobId?: number }
  | { status: 'not_found' }
  | { status: 'conflict'; error: string }
  | { status: 'invalid'; error: string };

function object(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function nonempty(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= maxLength
    ? value.trim()
    : null;
}

function nullableString(
  value: unknown,
  maxLength: number,
): string | null | false {
  if (value === null) return null;
  return nonempty(value, maxLength) ?? false;
}

function stringList(
  value: unknown,
  allowed: ReadonlySet<string> | null,
  maxItems: number,
  maxLength: number,
): string[] | null {
  if (
    !Array.isArray(value) ||
    value.length > maxItems ||
    value.some(
      (item) =>
        typeof item !== 'string' ||
        item.trim().length === 0 ||
        item.length > maxLength ||
        (allowed !== null && !allowed.has(item)),
    )
  ) {
    return null;
  }
  return [...new Set(value.map((item) => item.trim()))];
}

function messages(value: unknown): Record<string, string> | null {
  const parsed = object(value);
  if (!parsed || Object.keys(parsed).length > 20) return null;
  const result: Record<string, string> = {};
  for (const [key, message] of Object.entries(parsed)) {
    if (
      !/^[a-z][a-z0-9_]{0,63}$/u.test(key) ||
      typeof message !== 'string' ||
      message.trim().length === 0 ||
      message.length > 200
    ) {
      return null;
    }
    result[key] = message.trim();
  }
  return result;
}

function visibleTextSafe(value: {
  name: string;
  summary: string;
  messages: Record<string, string>;
}): boolean {
  return Object.values(value.messages)
    .concat(value.name, value.summary)
    .every((text) => matchPatterns(text).hard.length === 0);
}

function parseSpec(value: unknown): Omit<RuleSpecification, 'source'> | null {
  const input = object(value);
  if (!input || input.specVersion !== 1) return null;
  const name = nonempty(input.name, 40);
  const summary = nonempty(input.summary, 1_000);
  const hooks = stringList(input.hooks, HOOKS, HOOKS.size, 32);
  const effects = stringList(input.effects, EFFECTS, EFFECTS.size, 32);
  const testPoints = stringList(input.testPoints, null, 20, 300);
  const notes =
    typeof input.notes === 'string' && input.notes.length <= 1_000
      ? input.notes.trim()
      : null;
  const allowedEffects = new Set(
    (hooks ?? []).flatMap((hook) => [...(EFFECTS_BY_HOOK[hook] ?? [])]),
  );
  if (
    !name ||
    !summary ||
    !hooks ||
    !effects ||
    effects.some((effect) => !allowedEffects.has(effect)) ||
    !testPoints ||
    testPoints.length === 0 ||
    notes === null
  ) {
    return null;
  }
  return {
    specVersion: 1,
    name,
    summary,
    hooks,
    effects,
    testPoints,
    notes,
  };
}

function parseScaffoldMeta(value: unknown): RuleScaffoldMeta | null {
  const input = object(value);
  if (!input) return null;
  const slug =
    typeof input.slug === 'string' &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(input.slug) &&
    input.slug.length <= 48
      ? input.slug
      : null;
  const parsedMessages = messages(input.messages);
  return slug && parsedMessages ? { slug, messages: parsedMessages } : null;
}

export function parseAiJudgement(value: unknown): AiJudgementResult | null {
  const input = object(value);
  if (!input || !JUDGEMENT_VERDICTS.includes(input.verdict as never)) {
    return null;
  }
  const verdict = input.verdict as JudgementVerdict;
  const rejectCategory =
    input.rejectCategory === null
      ? null
      : REJECT_CATEGORIES.includes(input.rejectCategory as never)
        ? (input.rejectCategory as RejectCategory)
        : false;
  const rejectSubtype =
    input.rejectSubtype === null
      ? null
      : typeof input.rejectSubtype === 'string' &&
          REJECT_SUBTYPES.has(input.rejectSubtype)
        ? input.rejectSubtype
        : false;
  const reasonForUser = nullableString(input.reasonForUser, 1_000);
  const reasonInternal = nonempty(input.reasonInternal, 4_000);
  const spec = input.spec === null ? null : parseSpec(input.spec);
  const scaffoldMeta =
    input.scaffoldMeta === null ? null : parseScaffoldMeta(input.scaffoldMeta);
  const model = nonempty(input.model, 100);
  const promptVersion = nonempty(input.promptVersion, 100);
  const validMetadata =
    typeof input.confidence === 'number' &&
    Number.isFinite(input.confidence) &&
    input.confidence >= 0 &&
    input.confidence <= 1 &&
    typeof input.latencyMs === 'number' &&
    Number.isSafeInteger(input.latencyMs) &&
    input.latencyMs >= 0;
  const verdictShape =
    verdict === 'approve'
      ? rejectCategory === null &&
        rejectSubtype === null &&
        reasonForUser === null &&
        spec !== null &&
        scaffoldMeta !== null &&
        visibleTextSafe({
          name: spec.name,
          summary: spec.summary,
          messages: scaffoldMeta.messages,
        })
      : verdict === 'reject'
        ? rejectCategory !== null &&
          rejectCategory !== false &&
          rejectSubtype !== false &&
          reasonForUser !== null &&
          reasonForUser !== false &&
          spec === null &&
          scaffoldMeta === null
        : rejectCategory === null &&
          rejectSubtype === null &&
          reasonForUser === null &&
          spec === null &&
          scaffoldMeta === null;
  const rejectPairValid =
    verdict !== 'reject' ||
    (rejectCategory !== null &&
      rejectCategory !== false &&
      rejectSubtype !== false &&
      (rejectCategory === 'other'
        ? rejectSubtype === null
        : rejectSubtype !== null &&
          CATEGORY_SUBTYPES[rejectCategory].has(rejectSubtype)));
  if (
    rejectCategory === false ||
    rejectSubtype === false ||
    reasonForUser === false ||
    !reasonInternal ||
    !model ||
    !promptVersion ||
    !validMetadata ||
    !verdictShape ||
    !rejectPairValid
  ) {
    return null;
  }
  return {
    verdict,
    rejectCategory,
    rejectSubtype,
    reasonForUser,
    reasonInternal,
    spec,
    scaffoldMeta,
    confidence: input.confidence as number,
    model,
    promptVersion,
    latencyMs: input.latencyMs as number,
  };
}

function reasonCode(category: RejectCategory): string {
  switch (category) {
    case 'contract':
      return 'infeasible_technical';
    case 'game_breaking':
      return 'breaks_game';
    case 'inappropriate':
      return 'inappropriate';
    case 'duplicate':
      return 'duplicate_rule';
    case 'unintelligible':
      return 'out_of_scope';
    case 'other':
      return 'other';
  }
}

function actor(value: unknown): string | null {
  return nonempty(value, 200);
}

export class PipelineJudgementService {
  readonly #pipeline: PipelineRepository;
  readonly #proposals: ProposalRepository;
  readonly #injection: InjectionRepository;
  readonly #now: () => number;

  constructor(
    pipeline: PipelineRepository,
    proposals: ProposalRepository,
    injection: InjectionRepository,
    now: () => number = Date.now,
  ) {
    this.#pipeline = pipeline;
    this.#proposals = proposals;
    this.#injection = injection;
    this.#now = now;
  }

  pending(limit = 100) {
    return this.#pipeline.pendingCx(limit);
  }

  pendingConfirmations(limit = 100) {
    return this.#pipeline.pendingConfirmations(limit);
  }

  recordAi(proposalId: string, input: unknown): PipelineMutationResult {
    const parsed = parseAiJudgement(input);
    if (!parsed) return { status: 'invalid', error: 'invalid_judgement' };
    const runId = nonempty(object(input)?.runId, 100);
    if (!runId) return { status: 'invalid', error: 'invalid_run_id' };
    const proposal = this.#proposals.findById(proposalId);
    const check = this.#injection.checkForProposal(proposalId);
    if (!proposal || proposal.status !== 'screening' || !check) {
      return { status: 'not_found' };
    }
    if (check.finalVerdict !== 'pass') {
      return { status: 'conflict', error: 'e6_not_passed' };
    }
    const existing = this.#pipeline.aiJudgementForRun(proposalId, runId);
    if (existing) {
      return { status: 'already_recorded', judgement: existing };
    }
    const spec =
      parsed.spec === null
        ? null
        : {
            ...parsed.spec,
            source: {
              kind: proposal.kind,
              title: proposal.name,
              body: proposal.body,
            },
          };
    const judgement = this.#pipeline.insertJudgement(proposalId, {
      ...parsed,
      spec,
      decidedBy: 'ai',
      sourceCheckId: check.id,
      sourceJudgementId: null,
      runId,
      actor: null,
      createdAt: this.#now(),
    });
    return { status: 'recorded', judgement };
  }

  confirmE6Rejection(
    proposalId: string,
    input: unknown,
  ): PipelineMutationResult {
    const value = object(input);
    const checkId = value?.checkId;
    const confirmedBy = actor(value?.actor);
    if (!Number.isSafeInteger(checkId) || !confirmedBy) {
      return { status: 'invalid', error: 'invalid_confirmation' };
    }
    return this.#pipeline.transaction(() => {
      const proposal = this.#proposals.findById(proposalId);
      const check = this.#injection.checkForProposal(proposalId);
      if (!proposal || !check) return { status: 'not_found' };
      const existing = this.#pipeline.developerConfirmation(
        proposalId,
        null,
        checkId as number,
      );
      if (existing) {
        return { status: 'already_confirmed', judgement: existing };
      }
      if (
        proposal.status !== 'screening' ||
        check.id !== checkId ||
        (check.finalVerdict !== 'block_soft' &&
          check.finalVerdict !== 'block_card')
      ) {
        return { status: 'conflict', error: 'stale_or_nonblocking_check' };
      }
      if (check.finalVerdict === 'block_card') {
        const card = this.#injection.confirmCard(proposalId, this.#now());
        if (card === 'not_found' || card === 'not_card') {
          return { status: 'conflict', error: `card_${card}` };
        }
      }
      const reasonForUser =
        '安全上の理由により、この提案は受け付けられませんでした。';
      const transitioned = this.#proposals.transitionProposal(
        proposalId,
        'screening',
        'rejected',
        { reasonCode: 'inappropriate', reasonText: reasonForUser },
        this.#now(),
      );
      if (transitioned !== 'transitioned') {
        return { status: 'conflict', error: 'proposal_transition_failed' };
      }
      const judgement = this.#pipeline.insertJudgement(proposalId, {
        verdict: 'reject',
        rejectCategory: 'inappropriate',
        rejectSubtype: 'C1',
        reasonForUser,
        reasonInternal: `Developer confirmed E6 ${check.finalVerdict}.`,
        spec: null,
        scaffoldMeta: null,
        confidence: null,
        decidedBy: 'developer',
        model: null,
        promptVersion: null,
        latencyMs: null,
        sourceCheckId: check.id,
        sourceJudgementId: null,
        runId: null,
        actor: confirmedBy,
        createdAt: this.#now(),
      });
      return { status: 'confirmed', judgement };
    });
  }

  confirmCxRejection(
    proposalId: string,
    input: unknown,
  ): PipelineMutationResult {
    const value = object(input);
    const judgementId = value?.judgementId;
    const confirmedBy = actor(value?.actor);
    if (!Number.isSafeInteger(judgementId) || !confirmedBy) {
      return { status: 'invalid', error: 'invalid_confirmation' };
    }
    return this.#pipeline.transaction(() => {
      const proposal = this.#proposals.findById(proposalId);
      const source = this.#pipeline.judgement(judgementId as number);
      if (!proposal || !source || source.proposalId !== proposalId) {
        return { status: 'not_found' };
      }
      const existing = this.#pipeline.developerConfirmation(
        proposalId,
        source.id,
        null,
      );
      if (existing) {
        return { status: 'already_confirmed', judgement: existing };
      }
      if (
        proposal.status !== 'screening' ||
        source.decidedBy !== 'ai' ||
        this.#pipeline.latestAiJudgement(proposalId)?.id !== source.id
      ) {
        return { status: 'conflict', error: 'stale_or_nonreject_judgement' };
      }
      const overrideCategory =
        value?.rejectCategory !== undefined &&
        REJECT_CATEGORIES.includes(value.rejectCategory as never)
          ? (value.rejectCategory as RejectCategory)
          : null;
      const overrideSubtype =
        typeof value?.rejectSubtype === 'string' &&
        REJECT_SUBTYPES.has(value.rejectSubtype)
          ? value.rejectSubtype
          : null;
      const overrideReason = nonempty(value?.reasonForUser, 1_000);
      const manualReview =
        source.verdict === 'needs_review' &&
        overrideCategory !== null &&
        overrideReason !== null &&
        (overrideCategory === 'other'
          ? overrideSubtype === null
          : overrideSubtype !== null &&
            CATEGORY_SUBTYPES[overrideCategory].has(overrideSubtype));
      const category =
        source.verdict === 'reject' ? source.rejectCategory : overrideCategory;
      const subtype =
        source.verdict === 'reject' ? source.rejectSubtype : overrideSubtype;
      const userReason =
        source.verdict === 'reject' ? source.reasonForUser : overrideReason;
      if (
        (source.verdict !== 'reject' && !manualReview) ||
        category === null ||
        (category !== 'other' && subtype === null) ||
        userReason === null
      ) {
        return { status: 'conflict', error: 'stale_or_nonreject_judgement' };
      }
      const transitioned = this.#proposals.transitionProposal(
        proposalId,
        'screening',
        'rejected',
        {
          reasonCode: reasonCode(category),
          reasonText: userReason,
        },
        this.#now(),
      );
      if (transitioned !== 'transitioned') {
        return { status: 'conflict', error: 'proposal_transition_failed' };
      }
      const judgement = this.#pipeline.insertJudgement(proposalId, {
        verdict: 'reject',
        rejectCategory: category,
        rejectSubtype: subtype,
        reasonForUser: userReason,
        reasonInternal:
          source.verdict === 'needs_review'
            ? 'Developer rejected a needs_review judgement.'
            : source.reasonInternal,
        spec: null,
        scaffoldMeta: null,
        confidence: source.confidence,
        decidedBy: 'developer',
        model: null,
        promptVersion: null,
        latencyMs: null,
        sourceCheckId: null,
        sourceJudgementId: source.id,
        runId: null,
        actor: confirmedBy,
        createdAt: this.#now(),
      });
      return { status: 'confirmed', judgement };
    });
  }

  approveSpec(proposalId: string, input: unknown): PipelineMutationResult {
    const value = object(input);
    const judgementId = value?.judgementId;
    const confirmedBy = actor(value?.actor);
    const approvedSpec = parseSpec(value?.spec);
    const approvedScaffoldMeta = parseScaffoldMeta(value?.scaffoldMeta);
    if (
      !Number.isSafeInteger(judgementId) ||
      !confirmedBy ||
      !approvedSpec ||
      !approvedScaffoldMeta ||
      !visibleTextSafe({
        name: approvedSpec.name,
        summary: approvedSpec.summary,
        messages: approvedScaffoldMeta.messages,
      })
    ) {
      return { status: 'invalid', error: 'invalid_spec_approval' };
    }
    return this.#pipeline.transaction(() => {
      const proposal = this.#proposals.findById(proposalId);
      const source = this.#pipeline.judgement(judgementId as number);
      if (!proposal || !source || source.proposalId !== proposalId) {
        return { status: 'not_found' };
      }
      const existing = this.#pipeline.developerConfirmation(
        proposalId,
        source.id,
        null,
      );
      const existingJob = this.#pipeline.jobForProposal(proposalId);
      if (existing && existingJob) {
        return {
          status: 'already_confirmed',
          judgement: existing,
          jobId: existingJob.id,
        };
      }
      if (
        proposal.status !== 'screening' ||
        source.decidedBy !== 'ai' ||
        (source.verdict !== 'approve' && source.verdict !== 'needs_review') ||
        this.#pipeline.latestAiJudgement(proposalId)?.id !== source.id
      ) {
        return { status: 'conflict', error: 'stale_or_unapprovable_judgement' };
      }
      const spec: RuleSpecification = {
        ...approvedSpec,
        source: {
          kind: proposal.kind,
          title: proposal.name,
          body: proposal.body,
        },
      };
      const judgement = this.#pipeline.insertJudgement(proposalId, {
        verdict: 'approve',
        rejectCategory: null,
        rejectSubtype: null,
        reasonForUser: null,
        reasonInternal:
          'Developer reviewed and approved the implementation SPEC.',
        spec,
        scaffoldMeta: approvedScaffoldMeta,
        confidence: null,
        decidedBy: 'developer',
        model: null,
        promptVersion: source.promptVersion,
        latencyMs: null,
        sourceCheckId: null,
        sourceJudgementId: source.id,
        runId: null,
        actor: confirmedBy,
        createdAt: this.#now(),
      });
      const job = this.#pipeline.createQueuedJob(
        proposalId,
        approvedScaffoldMeta.slug,
        source.promptVersion,
        this.#now(),
      );
      const transitioned = this.#proposals.transitionProposal(
        proposalId,
        'screening',
        'implementing',
        {},
        this.#now(),
      );
      if (transitioned !== 'transitioned') {
        throw new Error('proposal_transition_failed');
      }
      return { status: 'confirmed', judgement, jobId: job.id };
    });
  }
}
