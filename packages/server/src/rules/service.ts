import {
  createInProcessRuleChainPort,
  ENGINE_CONTRACT_VERSION,
  sortRuleChain,
  type RuleChainEntry,
  type RuleChainPort,
  type RuleExecutionIssue,
  type RuleModule,
} from '@daifugo/core';
import type { AiRuleBundleRef } from '@daifugo/ai';

import type {
  PipelineJob,
  PipelineRepository,
} from '../pipeline/repository.js';
import type {
  ProposalRepository,
  StoredProposal,
} from '../proposal/repository.js';
import type {
  RuleDisabledReason,
  RuleIncidentType,
  RuleRepository,
  StoredRule,
  StoredRuleIncident,
  StoredRuleVersion,
} from './repository.js';

const DAY_MS = 24 * 60 * 60 * 1_000;
export const AUTO_DISABLE_SET_THRESHOLD = 3;
export const AUTO_DISABLE_WINDOW_MS = DAY_MS;

type ManualDisabledReason = Extract<RuleDisabledReason, 'manual' | 'rollback'>;

export interface CodeRuleRegistration {
  module: RuleModule;
  bundleHash: string;
  moduleUrl: string;
  slug: string;
  version: number;
}

export type RuleControlResult =
  | {
      status: 'found';
      rule: StoredRule;
      versions: StoredRuleVersion[];
      incidents: StoredRuleIncident[];
      releaseReady: boolean;
    }
  | { status: 'updated'; rule: StoredRule }
  | { status: 'unchanged'; rule: StoredRule }
  | { status: 'not_found' }
  | {
      status: 'conflict';
      error:
        | 'rule_removed'
        | 'rule_unavailable'
        | 'release_unavailable'
        | 'release_pending'
        | 'status_changed';
    }
  | { status: 'invalid'; error: 'invalid_reason' };

export interface RecordedRuleIncident {
  incident: StoredRuleIncident;
  inserted: boolean;
  autoDisabled: StoredRule | null;
}

export interface RuleRegistrySyncFailure {
  ruleId: string;
  detail: string;
}

export interface RuleRegistrySyncResult {
  registered: StoredRule[];
  versions: StoredRuleVersion[];
  reverted: StoredRule[];
  failures: RuleRegistrySyncFailure[];
}

type ProposalReleaseRepository = Pick<
  ProposalRepository,
  'findById' | 'transitionProposal'
>;
type PipelineReleaseRepository = Pick<
  PipelineRepository,
  'jobForProposal' | 'transitionJob'
>;

class ReleaseConflict extends Error {}

function disabledReason(value: unknown): ManualDisabledReason | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !('reason' in value)
  ) {
    return null;
  }
  return value.reason === 'manual' || value.reason === 'rollback'
    ? value.reason
    : null;
}

function registryIssue(
  rule: StoredRule,
  registrations: readonly CodeRuleRegistration[],
): string | null {
  if (registrations.length === 0) return 'code module is missing';
  if (registrations.length > 1) return 'duplicate code modules';
  const meta = registrations[0]!.module.meta;
  if (meta.contractVersion !== ENGINE_CONTRACT_VERSION) {
    return `unsupported contract version: ${String(meta.contractVersion)}`;
  }
  if (
    meta.ruleId !== rule.id ||
    meta.name !== rule.name ||
    meta.description !== rule.description ||
    meta.kind !== rule.kind ||
    (meta.prefecture ?? null) !== rule.prefecture ||
    meta.proposalId !== rule.proposalId
  ) {
    return 'code metadata does not match the database';
  }
  if (registrations[0]!.slug !== rule.slug) {
    return 'code slug does not match the database';
  }
  return null;
}

function versionIssue(
  version: StoredRuleVersion | null,
  registration: CodeRuleRegistration,
  source: { proposal: StoredProposal; job: PipelineJob },
): string | null {
  if (!version) return 'current rule version is missing';
  if (!version.isCurrent || version.revertedAt !== null) {
    return 'rule version is reverted';
  }
  if (
    version.version !== registration.version ||
    version.contractVersion !== registration.module.meta.contractVersion ||
    version.prNumber !== source.job.prNumber ||
    version.mergeSha !== source.job.mergeSha ||
    version.bundleHash !== registration.bundleHash
  ) {
    return 'rule version provenance does not match deployed code';
  }
  return null;
}

function incidentType(issue: RuleExecutionIssue): RuleIncidentType {
  return issue.reason === 'exception' ? 'exception' : 'invalid_effect';
}

export class RuleRegistryService {
  readonly #repository: RuleRepository;
  readonly #codeById = new Map<string, CodeRuleRegistration[]>();
  readonly #now: () => number;
  readonly #onAutoDisable:
    ((rule: StoredRule, incident: StoredRuleIncident) => void) | undefined;
  readonly #onLoadFailure:
    ((rule: StoredRule, incident: StoredRuleIncident) => void) | undefined;
  readonly #onReleased: ((rule: StoredRule) => void) | undefined;
  readonly #onAvailabilityChanged: (() => void) | undefined;
  readonly #proposals: ProposalReleaseRepository | undefined;
  readonly #pipeline: PipelineReleaseRepository | undefined;
  readonly #ports = new Map<
    string,
    { port: RuleChainPort; disabled: Set<string> }
  >();

  constructor(
    repository: RuleRepository,
    codeRules: readonly CodeRuleRegistration[],
    options: {
      now?: () => number;
      onAutoDisable?: (rule: StoredRule, incident: StoredRuleIncident) => void;
      onLoadFailure?: (rule: StoredRule, incident: StoredRuleIncident) => void;
      onReleased?: (rule: StoredRule) => void;
      onAvailabilityChanged?: () => void;
      proposals?: ProposalReleaseRepository;
      pipeline?: PipelineReleaseRepository;
    } = {},
  ) {
    this.#repository = repository;
    for (const registration of codeRules) {
      const registrations =
        this.#codeById.get(registration.module.meta.ruleId) ?? [];
      registrations.push(registration);
      this.#codeById.set(registration.module.meta.ruleId, registrations);
    }
    this.#now = options.now ?? Date.now;
    this.#onAutoDisable = options.onAutoDisable;
    this.#onLoadFailure = options.onLoadFailure;
    this.#onReleased = options.onReleased;
    this.#onAvailabilityChanged = options.onAvailabilityChanged;
    this.#proposals = options.proposals;
    this.#pipeline = options.pipeline;
  }

  synchronizeCodeRegistry(): RuleRegistrySyncResult {
    const registered: StoredRule[] = [];
    const versions: StoredRuleVersion[] = [];
    const failures: RuleRegistrySyncFailure[] = [];
    const codeRuleIds = new Set(this.#codeById.keys());
    for (const [ruleId, registrations] of this.#codeById) {
      if (registrations.length !== 1) {
        failures.push({ ruleId, detail: 'duplicate code modules' });
        continue;
      }
      const registration = registrations[0]!;
      const meta = registration.module.meta;
      const source = this.#releaseSource(meta.proposalId);
      const sourceIssue = this.#releaseSourceIssue(registration, source);
      if (sourceIssue) {
        failures.push({ ruleId, detail: sourceIssue });
        continue;
      }
      const now = this.#now();
      try {
        const synchronized = this.#repository.transaction(() => {
          let createdRule: StoredRule | null = null;
          let createdVersion: StoredRuleVersion | null = null;
          let rule = this.#repository.get(ruleId);
          if (!rule) {
            rule = this.#repository.register({
              id: ruleId,
              slug: registration.slug,
              name: meta.name,
              description: meta.description,
              kind: meta.kind,
              prefecture: meta.prefecture ?? null,
              proposalId: meta.proposalId,
              status: 'disabled',
              disabledReason: 'pending_enable',
              now,
            });
            createdRule = rule;
          } else {
            const issue = registryIssue(rule, registrations);
            if (issue) throw new Error(issue);
          }
          const existingVersion = this.#repository
            .versions(ruleId)
            .find(({ version }) => version === registration.version);
          if (!existingVersion) {
            createdVersion = this.#repository.registerVersion({
              ruleId,
              version: registration.version,
              contractVersion: meta.contractVersion,
              prNumber: source!.job.prNumber,
              mergeSha: source!.job.mergeSha,
              bundleHash: registration.bundleHash,
              now,
            });
          } else if (
            existingVersion.bundleHash === null &&
            existingVersion.isCurrent &&
            existingVersion.revertedAt === null &&
            source!.job.prNumber !== null &&
            source!.job.mergeSha !== null
          ) {
            createdVersion = this.#repository.attestLegacyBundle({
              ruleId,
              version: registration.version,
              contractVersion: meta.contractVersion,
              prNumber: source!.job.prNumber,
              mergeSha: source!.job.mergeSha,
              bundleHash: registration.bundleHash,
            });
            if (!createdVersion) {
              throw new Error(
                'legacy rule version provenance does not match deployed code',
              );
            }
          } else {
            const issue = versionIssue(existingVersion, registration, source!);
            if (issue) throw new Error(issue);
          }
          return { createdRule, createdVersion };
        });
        if (synchronized.createdRule) registered.push(synchronized.createdRule);
        if (synchronized.createdVersion) {
          versions.push(synchronized.createdVersion);
        }
      } catch (error) {
        failures.push({
          ruleId,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return {
      registered,
      versions,
      reverted: this.#repository.markMissingCodeReverted(
        codeRuleIds,
        this.#now(),
      ),
      failures,
    };
  }

  availableRules(setId?: string): RuleChainEntry[] {
    const entries: RuleChainEntry[] = [];
    for (const rule of this.#repository.active()) {
      const registrations = this.#codeById.get(rule.id) ?? [];
      const issue = this.#runtimeIssue(rule, registrations);
      if (issue) {
        if (setId) {
          const recorded = this.recordIncident({
            ruleId: rule.id,
            setId,
            type: 'load_failure',
            detail: issue,
          });
          if (recorded.inserted) {
            this.#onLoadFailure?.(rule, recorded.incident);
          }
        }
        continue;
      }
      const registration = registrations[0]!;
      entries.push({
        ruleId: rule.id,
        name: rule.name,
        position: entries.length,
        priority: {
          score: rule.popularityScore,
          activatedAt: rule.activatedAt ?? rule.createdAt,
          ruleId: rule.id,
        },
        bundleHash: registration.bundleHash,
        contractVersion: registration.module.meta.contractVersion,
      });
    }
    return sortRuleChain(entries);
  }

  resolveMessage(
    ruleId: string,
    messageKey: string,
    params: Readonly<Record<string, string>> = {},
  ): string | null {
    const registrations = this.#codeById.get(ruleId);
    if (registrations?.length !== 1) return null;
    const template = registrations[0]!.module.meta.messages[messageKey];
    if (template === undefined) return null;
    return template.replaceAll(/\{([A-Za-z0-9_-]+)\}/g, (match, key: string) =>
      Object.hasOwn(params, key) ? params[key]! : match,
    );
  }

  aiRuleBundles(entries: readonly RuleChainEntry[]): AiRuleBundleRef[] {
    return entries.map((entry) => {
      const registration = this.#codeById.get(entry.ruleId);
      if (
        registration?.length !== 1 ||
        registration[0]!.bundleHash !== entry.bundleHash ||
        registration[0]!.module.meta.contractVersion !== entry.contractVersion
      ) {
        throw new Error(`AI rule bundle is unavailable: ${entry.ruleId}`);
      }
      return {
        ruleId: entry.ruleId,
        moduleUrl: registration[0]!.moduleUrl,
        bundleHash: entry.bundleHash,
        contractVersion: entry.contractVersion,
        meta: structuredClone(registration[0]!.module.meta),
      };
    });
  }

  effectiveRuleChainForSet(
    setId: string,
    entries: readonly RuleChainEntry[],
  ): RuleChainEntry[] {
    const disabled = this.#ports.get(setId)?.disabled;
    return structuredClone(
      disabled
        ? entries.filter((entry) => !disabled.has(entry.ruleId))
        : [...entries],
    );
  }

  get(ruleId: string): RuleControlResult {
    // A deployment can start before the human-operated merge command records
    // the PR as merged. Reconcile here as well as at startup so the release
    // status poll can register code once that durable provenance is available.
    this.synchronizeCodeRegistry();
    const rule = this.#repository.get(ruleId);
    return rule
      ? {
          status: 'found',
          rule,
          versions: this.#repository.versions(ruleId),
          incidents: this.#repository.incidents(ruleId),
          releaseReady:
            this.#deploymentIssue(rule, this.#codeById.get(rule.id) ?? []) ===
            null,
        }
      : { status: 'not_found' };
  }

  priority() {
    return this.#repository.priority().map((rule) => ({
      ruleId: rule.id,
      up: rule.ratingUp,
      down: rule.ratingDown,
      popularityScore: rule.popularityScore,
      priorityRank: rule.priorityRank,
      activatedAt: rule.activatedAt,
      popularityUpdatedAt: rule.popularityUpdatedAt,
    }));
  }

  conflicts(query: { setId?: string; ruleId?: string; limit?: number }) {
    return this.#repository.conflicts(query);
  }

  snapshot(setId: string) {
    return this.#repository.snapshot(setId);
  }

  recordConflict(input: {
    setId: string;
    gameIndex: number;
    playSeq: number;
    hook: string;
    conflictKey: string;
    adoptedRuleId: string;
    entries: unknown[];
  }): void {
    this.#repository.recordConflict({ ...input, now: this.#now() });
  }

  disable(ruleId: string, body: unknown): RuleControlResult {
    const reason = disabledReason(body);
    if (!reason) return { status: 'invalid', error: 'invalid_reason' };
    const existing = this.#repository.get(ruleId);
    if (!existing) return { status: 'not_found' };
    if (existing.status === 'removed') {
      return { status: 'conflict', error: 'rule_removed' };
    }
    if (
      existing.status === 'disabled' &&
      existing.disabledReason === 'pending_enable'
    ) {
      return { status: 'conflict', error: 'release_pending' };
    }
    if (existing.status === 'disabled' && existing.disabledReason === reason) {
      return { status: 'unchanged', rule: existing };
    }
    const transition = this.#repository.transition({
      ruleId,
      expectedStatuses: [existing.status],
      nextStatus: 'disabled',
      disabledReason: reason,
      now: this.#now(),
    });
    if (transition.changed && transition.rule) {
      this.#notifyAvailabilityChanged();
      return { status: 'updated', rule: transition.rule };
    }
    return { status: 'conflict', error: 'status_changed' };
  }

  enable(ruleId: string): RuleControlResult {
    const existing = this.#repository.get(ruleId);
    if (!existing) return { status: 'not_found' };
    if (existing.status === 'removed') {
      return { status: 'conflict', error: 'rule_removed' };
    }
    if (
      registryIssue(existing, this.#codeById.get(existing.id) ?? []) !== null
    ) {
      return { status: 'conflict', error: 'rule_unavailable' };
    }
    if (!this.#proposals || !this.#pipeline) {
      if (existing.status === 'active') {
        return { status: 'unchanged', rule: existing };
      }
      const transition = this.#repository.transition({
        ruleId,
        expectedStatuses: ['disabled'],
        nextStatus: 'active',
        disabledReason: null,
        now: this.#now(),
      });
      if (transition.changed && transition.rule) {
        this.#notifyAvailabilityChanged();
        return { status: 'updated', rule: transition.rule };
      }
      return { status: 'conflict', error: 'status_changed' };
    }
    const registration = this.#codeById.get(existing.id)![0]!;
    const source = this.#releaseSource(existing.proposalId);
    if (
      !source ||
      versionIssue(
        this.#repository.currentVersion(existing.id),
        registration,
        source,
      ) !== null
    ) {
      return { status: 'conflict', error: 'rule_unavailable' };
    }
    const firstRelease =
      source.proposal.status === 'implementing' &&
      source.job.phase === 'merged';
    const released =
      source.proposal.status === 'released' &&
      source.proposal.ruleId === existing.id &&
      source.job.phase === 'done';
    if (!firstRelease && !released) {
      return { status: 'conflict', error: 'release_unavailable' };
    }
    if (existing.status === 'active') {
      return { status: 'unchanged', rule: existing };
    }
    const now = this.#now();
    try {
      const result = this.#repository.transaction(() => {
        if (firstRelease) {
          this.#releaseProposal(existing, now);
        }
        const transition = this.#repository.transition({
          ruleId,
          expectedStatuses: ['disabled'],
          nextStatus: 'active',
          disabledReason: null,
          now,
        });
        if (!transition.changed || !transition.rule) {
          throw new ReleaseConflict('rule status changed');
        }
        return { status: 'updated', rule: transition.rule } as const;
      });
      if (firstRelease) {
        try {
          this.#onReleased?.(result.rule);
        } catch {
          // The durable release already committed. Operational logging is
          // deliberately best-effort and must not turn success into HTTP 500.
        }
      }
      this.#notifyAvailabilityChanged();
      return result;
    } catch (error) {
      return error instanceof ReleaseConflict
        ? { status: 'conflict', error: 'release_unavailable' }
        : (() => {
            throw error;
          })();
    }
  }

  recordIncident(input: {
    ruleId: string;
    setId: string;
    type: RuleIncidentType;
    detail: string | null;
  }): RecordedRuleIncident {
    const result = this.#repository.transaction(() => {
      const now = this.#now();
      const recorded = this.#repository.recordIncident({
        ...input,
        detail: input.detail?.slice(0, 4_000) ?? null,
        now,
      });
      let autoDisabled: StoredRule | null = null;
      if (
        this.#repository.distinctIncidentSetsSince(
          input.ruleId,
          now - AUTO_DISABLE_WINDOW_MS,
        ) >= AUTO_DISABLE_SET_THRESHOLD
      ) {
        const transition = this.#repository.transition({
          ruleId: input.ruleId,
          expectedStatuses: ['active'],
          nextStatus: 'disabled',
          disabledReason: 'auto_incident',
          now,
        });
        autoDisabled = transition.changed ? transition.rule : null;
      }
      if (autoDisabled) {
        this.#onAutoDisable?.(autoDisabled, recorded.incident);
      }
      return { ...recorded, autoDisabled };
    });
    if (result.autoDisabled) this.#notifyAvailabilityChanged();
    return result;
  }

  #notifyAvailabilityChanged(): void {
    try {
      this.#onAvailabilityChanged?.();
    } catch {
      // Room preview updates are best effort; the next room action re-reads
      // the authoritative registry before a set starts.
    }
  }

  rulePortForSet(setId: string): RuleChainPort {
    let runtime = this.#ports.get(setId);
    if (!runtime) {
      const disabled = new Set<string>();
      const modules = [...this.#codeById.values()]
        .filter((registrations) => registrations.length === 1)
        .map(([registration]) => registration!.module);
      const inner = createInProcessRuleChainPort(modules, {
        onIssue: (issue) => {
          disabled.add(issue.ruleId);
          this.recordIncident({
            ruleId: issue.ruleId,
            setId,
            type: incidentType(issue),
            detail: `${String(issue.hook)}: ${issue.reason}`,
          });
        },
      });
      const active = (entries: RuleChainEntry[]) =>
        entries.filter((entry) => !disabled.has(entry.ruleId));
      const port: RuleChainPort = {
        disableRule: (ruleId) => {
          disabled.add(ruleId);
          inner.disableRule?.(ruleId);
        },
        modifyLegality: (entries, context, plays, base) =>
          inner.modifyLegality(active(entries), context, plays, base),
        modifyStrength: (entries, context, base) =>
          inner.modifyStrength(active(entries), context, base),
        collectEffects: (hook, entries, context, argument) =>
          inner.collectEffects(hook, active(entries), context, argument),
      };
      runtime = { port, disabled };
      this.#ports.set(setId, runtime);
    }
    return runtime.port;
  }

  disableRuleInSet(setId: string, ruleId: string): void {
    this.#ports.get(setId)?.disabled.add(ruleId);
  }

  releaseRulePort(setId: string): void {
    this.#ports.delete(setId);
  }

  reconcileRevertedCode(): StoredRule[] {
    return this.#repository.markMissingCodeReverted(
      new Set(this.#codeById.keys()),
      this.#now(),
    );
  }

  #releaseSource(
    proposalId: string,
  ): { proposal: StoredProposal; job: PipelineJob } | null {
    const proposal = this.#proposals?.findById(proposalId);
    const job = this.#pipeline?.jobForProposal(proposalId);
    return proposal && job ? { proposal, job } : null;
  }

  #runtimeIssue(
    rule: StoredRule,
    registrations: readonly CodeRuleRegistration[],
  ): string | null {
    const issue = registryIssue(rule, registrations);
    if (issue || !this.#proposals || !this.#pipeline) return issue;
    const registration = registrations[0]!;
    const source = this.#releaseSource(rule.proposalId);
    if (
      source &&
      (source.proposal.status !== 'released' || source.job.phase !== 'done')
    ) {
      return `active rule release state does not match: ${source.proposal.status}/${source.job.phase}`;
    }
    const sourceIssue = this.#releaseSourceIssue(registration, source);
    if (sourceIssue || !source) return sourceIssue;
    return versionIssue(
      this.#repository.currentVersion(rule.id),
      registration,
      source,
    );
  }

  #deploymentIssue(
    rule: StoredRule,
    registrations: readonly CodeRuleRegistration[],
  ): string | null {
    const issue = registryIssue(rule, registrations);
    if (issue || !this.#proposals || !this.#pipeline) return issue;
    const registration = registrations[0]!;
    const source = this.#releaseSource(rule.proposalId);
    const sourceIssue = this.#releaseSourceIssue(registration, source);
    if (sourceIssue || !source) return sourceIssue;
    return versionIssue(
      this.#repository.currentVersion(rule.id),
      registration,
      source,
    );
  }

  #releaseSourceIssue(
    registration: CodeRuleRegistration,
    source: { proposal: StoredProposal; job: PipelineJob } | null,
  ): string | null {
    const meta = registration.module.meta;
    if (!source) return 'proposal or pipeline job is missing';
    if (!(
      (source.proposal.status === 'implementing' &&
        source.job.phase === 'merged') ||
      (source.proposal.status === 'released' && source.job.phase === 'done')
    )) {
      return `release lifecycle state does not match: ${source.proposal.status}/${source.job.phase}`;
    }
    if (
      source.job.ruleId !== meta.ruleId ||
      source.job.slug !== registration.slug ||
      source.job.proposalId !== meta.proposalId
    ) {
      return 'pipeline job does not match code metadata';
    }
    if (
      source.proposal.id !== meta.proposalId ||
      source.proposal.kind !== meta.kind
    ) {
      return 'proposal does not match code metadata';
    }
    if (
      !Number.isSafeInteger(registration.version) ||
      registration.version < 1
    ) {
      return 'invalid rule version';
    }
    if (
      source.job.prNumber === null ||
      source.job.headSha === null ||
      source.job.mergeSha === null
    ) {
      return 'pipeline merge provenance is incomplete';
    }
    if (!/^[0-9a-f]{64}$/u.test(registration.bundleHash)) {
      return 'invalid deployed bundle hash';
    }
    return null;
  }

  #releaseProposal(rule: StoredRule, now: number): void {
    const source = this.#releaseSource(rule.proposalId);
    if (!source || source.job.ruleId !== rule.id) {
      throw new ReleaseConflict('release source is unavailable');
    }
    if (
      source.proposal.status === 'released' &&
      source.proposal.ruleId === rule.id &&
      source.job.phase === 'done'
    ) {
      return;
    }
    if (
      source.proposal.status !== 'implementing' ||
      source.job.phase !== 'merged'
    ) {
      throw new ReleaseConflict('release source is not ready');
    }
    const job = this.#pipeline!.transitionJob(
      source.job.id,
      'merged',
      'done',
      {},
      now,
    );
    const proposal = this.#proposals!.transitionProposal(
      rule.proposalId,
      'implementing',
      'released',
      { ruleId: rule.id },
      now,
    );
    if (!job || proposal !== 'transitioned') {
      throw new ReleaseConflict('release transition failed');
    }
  }
}
