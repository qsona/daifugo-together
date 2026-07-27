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
}

export type RuleControlResult =
  | {
      status: 'found';
      rule: StoredRule;
      versions: StoredRuleVersion[];
      incidents: StoredRuleIncident[];
    }
  | { status: 'updated'; rule: StoredRule }
  | { status: 'unchanged'; rule: StoredRule }
  | { status: 'not_found' }
  | {
      status: 'conflict';
      error: 'rule_removed' | 'rule_unavailable' | 'status_changed';
    }
  | { status: 'invalid'; error: 'invalid_reason' };

export interface RecordedRuleIncident {
  incident: StoredRuleIncident;
  inserted: boolean;
  autoDisabled: StoredRule | null;
}

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
  }

  availableRules(setId?: string): RuleChainEntry[] {
    const entries: RuleChainEntry[] = [];
    for (const rule of this.#repository.active()) {
      const registrations = this.#codeById.get(rule.id) ?? [];
      const issue = registryIssue(rule, registrations);
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
          score: 0,
          activatedAt: rule.createdAt,
          ruleId: rule.id,
        },
        bundleHash: registration.bundleHash,
        contractVersion: registration.module.meta.contractVersion,
      });
    }
    return sortRuleChain(entries);
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
      };
    });
  }

  get(ruleId: string): RuleControlResult {
    const rule = this.#repository.get(ruleId);
    return rule
      ? {
          status: 'found',
          rule,
          versions: this.#repository.versions(ruleId),
          incidents: this.#repository.incidents(ruleId),
        }
      : { status: 'not_found' };
  }

  disable(ruleId: string, body: unknown): RuleControlResult {
    const reason = disabledReason(body);
    if (!reason) return { status: 'invalid', error: 'invalid_reason' };
    const existing = this.#repository.get(ruleId);
    if (!existing) return { status: 'not_found' };
    if (existing.status === 'removed') {
      return { status: 'conflict', error: 'rule_removed' };
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
    return transition.changed && transition.rule
      ? { status: 'updated', rule: transition.rule }
      : { status: 'conflict', error: 'status_changed' };
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
    return transition.changed && transition.rule
      ? { status: 'updated', rule: transition.rule }
      : { status: 'conflict', error: 'status_changed' };
  }

  recordIncident(input: {
    ruleId: string;
    setId: string;
    type: RuleIncidentType;
    detail: string | null;
  }): RecordedRuleIncident {
    return this.#repository.transaction(() => {
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
}
