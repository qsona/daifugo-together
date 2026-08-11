import { matchPatterns } from '../injection/patterns.js';
import type { InjectionRepository } from '../injection/repository.js';
import type { ProposalRepository } from '../proposal/repository.js';
import type { NotificationService } from '../notification/service.js';
import {
  JUDGEMENT_VERDICTS,
  PipelineRepository,
  REJECT_CATEGORIES,
  type ExtensionNeeded,
  type JudgementVerdict,
  type RejectCategory,
  type RuleScaffoldMeta,
  type RuleSpecification,
  type StoredJudgement,
} from './repository.js';

export type { ExtensionNeeded } from './repository.js';

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
  'requestChoice',
  'skipTurns',
  'reverseTurnOrder',
  'forceRank',
  'moveCards',
  'setMemory',
  'announce',
]);
// announce は公開通知と、rule.ts が players を指定する対象者限定通知の両方を表す。
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
    'requestChoice',
    'skipTurns',
    'reverseTurnOrder',
    'forceRank',
    'moveCards',
    'setMemory',
    'announce',
  ]),
  onGameEnd: new Set(['setMemory', 'announce']),
};
// core の EngineFeature と同じ語彙。core 側の実装とは独立に検証する。
const ENGINE_FEATURES = new Set(['sequence', 'jokers']);
const CAPABILITY_PATTERN = /^[a-z][a-z0-9_-]*(:[a-z0-9_.-]+)?$/u;
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
  extensionNeeded: ExtensionNeeded | null;
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
  const engineFeatures =
    input.engineFeatures === undefined
      ? []
      : stringList(
          input.engineFeatures,
          ENGINE_FEATURES,
          ENGINE_FEATURES.size,
          32,
        );
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
    !engineFeatures ||
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
    engineFeatures,
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
  const contractVersion =
    input.contractVersion === undefined
      ? 1
      : input.contractVersion === 1 || input.contractVersion === 2
        ? input.contractVersion
        : null;
  return slug && parsedMessages && contractVersion
    ? { slug, contractVersion, messages: parsedMessages }
    : null;
}

// undefined/null は既存クライアント互換のため null 相当として受理する。
// object だが capabilities/sketch が不正なときだけ false (invalid) を返す。
function parseExtensionNeeded(value: unknown): ExtensionNeeded | null | false {
  if (value === undefined || value === null) return null;
  const input = object(value);
  if (!input) return false;
  const rawCapabilities = input.capabilities;
  const capabilities =
    Array.isArray(rawCapabilities) &&
    rawCapabilities.length >= 1 &&
    rawCapabilities.length <= 4 &&
    rawCapabilities.every(
      (item) =>
        typeof item === 'string' &&
        item.length <= 64 &&
        CAPABILITY_PATTERN.test(item),
    )
      ? [...(rawCapabilities as string[])]
      : null;
  const sketch = nonempty(input.sketch, 1_000);
  return capabilities && sketch ? { capabilities, sketch } : false;
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
  const extensionNeeded = parseExtensionNeeded(input.extensionNeeded);
  // 拡張ヒントは needs_review 専用。approve/reject での非null は invalid とする。
  const extensionNeededCrossFieldValid =
    extensionNeeded === null || verdict === 'needs_review';
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
    extensionNeeded === false ||
    !extensionNeededCrossFieldValid ||
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
    extensionNeeded,
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
  readonly #notifications:
    Pick<NotificationService, 'publishProposal'> | undefined;

  constructor(
    pipeline: PipelineRepository,
    proposals: ProposalRepository,
    injection: InjectionRepository,
    now: () => number = Date.now,
    notifications?: Pick<NotificationService, 'publishProposal'>,
  ) {
    this.#pipeline = pipeline;
    this.#proposals = proposals;
    this.#injection = injection;
    this.#now = now;
    this.#notifications = notifications;
  }

  pending(limit = 100, currentPromptVersion?: string) {
    return this.#pipeline.pendingCx(limit, currentPromptVersion);
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
    // 同一プロンプト版での再判定は挿入しない (旧版判定があるだけなら新規挿入し、
    // それが latest になる)。
    const latest = this.#pipeline.latestAiJudgement(proposalId);
    if (latest && latest.promptVersion === parsed.promptVersion) {
      return { status: 'already_recorded', judgement: latest };
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
    const result: PipelineMutationResult = this.#pipeline.transaction(() => {
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
        extensionNeeded: null,
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
    if (result.status === 'confirmed') {
      this.#notify('proposal_rejected', proposalId);
    }
    return result;
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
    const result: PipelineMutationResult = this.#pipeline.transaction(() => {
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
      const overrideSubtypeWasProvided =
        value?.rejectSubtype !== undefined && value.rejectSubtype !== null;
      const manualReview =
        overrideCategory !== null &&
        overrideReason !== null &&
        (!overrideSubtypeWasProvided ||
          (overrideSubtype !== null &&
            CATEGORY_SUBTYPES[overrideCategory].has(overrideSubtype)));
      const category = manualReview ? overrideCategory : source.rejectCategory;
      const subtype = manualReview ? overrideSubtype : source.rejectSubtype;
      const userReason = manualReview ? overrideReason : source.reasonForUser;
      if (
        (source.verdict !== 'reject' && !manualReview) ||
        category === null ||
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
        reasonInternal: manualReview
          ? `Developer rejected an AI ${source.verdict} judgement.`
          : source.reasonInternal,
        spec: null,
        scaffoldMeta: null,
        extensionNeeded: null,
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
    if (result.status === 'confirmed') {
      this.#notify('proposal_rejected', proposalId);
    }
    return result;
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
    const result: PipelineMutationResult = this.#pipeline.transaction(() => {
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
        extensionNeeded: null,
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
        null,
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
    if (result.status === 'confirmed') {
      this.#notify('proposal_implementing', proposalId);
    }
    return result;
  }

  amendSpec(proposalId: string, input: unknown): PipelineMutationResult {
    const value = object(input);
    const jobId = value?.jobId;
    const judgementId = value?.judgementId;
    const confirmedBy = actor(value?.actor);
    const approvedSpec = parseSpec(value?.spec);
    const approvedScaffoldMeta = parseScaffoldMeta(value?.scaffoldMeta);
    if (
      !Number.isSafeInteger(jobId) ||
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
      return { status: 'invalid', error: 'invalid_spec_amendment' };
    }
    return this.#pipeline.transaction(() => {
      const proposal = this.#proposals.findById(proposalId);
      const item = this.#pipeline.implementation(jobId as number);
      const source = this.#pipeline.judgement(judgementId as number);
      if (
        !proposal ||
        !item ||
        !source ||
        item.proposal.id !== proposalId ||
        source.proposalId !== proposalId
      ) {
        return { status: 'not_found' };
      }
      const existing = this.#pipeline.developerConfirmation(
        proposalId,
        source.id,
        null,
      );
      if (existing) {
        return {
          status: 'already_confirmed',
          judgement: existing,
          jobId: item.job.id,
        };
      }
      if (
        proposal.status !== 'implementing' ||
        item.approvedJudgementId !== source.id ||
        source.verdict !== 'approve' ||
        source.decidedBy !== 'developer' ||
        (item.job.phase !== 'queued' &&
          item.job.phase !== 'implementing' &&
          item.job.phase !== 'pr_open') ||
        approvedScaffoldMeta.slug !== item.job.slug
      ) {
        return { status: 'conflict', error: 'stale_or_unamendable_spec' };
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
          'Developer amended the approved SPEC before rule review.',
        spec,
        scaffoldMeta: approvedScaffoldMeta,
        extensionNeeded: null,
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
      return {
        status: 'confirmed',
        judgement,
        jobId: item.job.id,
      };
    });
  }

  #notify(
    type: 'proposal_rejected' | 'proposal_implementing',
    proposalId: string,
  ): void {
    const proposal = this.#proposals.findById(proposalId);
    if (proposal) this.#notifications?.publishProposal(type, proposal);
  }
}
