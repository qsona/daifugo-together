import type { RuleChainEntry } from '@daifugo/core';

import type {
  RuleDisabledReason,
  RuleRepository,
  StoredRule,
} from './repository.js';

type ManualDisabledReason = Extract<RuleDisabledReason, 'manual' | 'rollback'>;

export type RuleControlResult =
  | { status: 'found'; rule: StoredRule }
  | { status: 'updated'; rule: StoredRule }
  | { status: 'unchanged'; rule: StoredRule }
  | { status: 'not_found' }
  | { status: 'conflict'; error: 'rule_removed' }
  | { status: 'invalid'; error: 'invalid_reason' };

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

export class RuleRegistryService {
  readonly #repository: RuleRepository;
  readonly #codeEntries: () => readonly RuleChainEntry[];
  readonly #now: () => number;

  constructor(
    repository: RuleRepository,
    codeEntries: readonly RuleChainEntry[] | (() => readonly RuleChainEntry[]),
    options: { now?: () => number } = {},
  ) {
    this.#repository = repository;
    this.#codeEntries =
      typeof codeEntries === 'function' ? codeEntries : () => codeEntries;
    this.#now = options.now ?? Date.now;
  }

  availableRules(): RuleChainEntry[] {
    const activeIds = this.#repository.activeIds();
    return this.#codeEntries()
      .filter((entry) => activeIds.has(entry.ruleId))
      .map((entry) => structuredClone(entry));
  }

  get(ruleId: string): RuleControlResult {
    const rule = this.#repository.get(ruleId);
    return rule ? { status: 'found', rule } : { status: 'not_found' };
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
    return {
      status: 'updated',
      rule: this.#repository.setDisabled(ruleId, reason, this.#now())!,
    };
  }

  enable(ruleId: string): RuleControlResult {
    const existing = this.#repository.get(ruleId);
    if (!existing) return { status: 'not_found' };
    if (existing.status === 'removed') {
      return { status: 'conflict', error: 'rule_removed' };
    }
    if (existing.status === 'active') {
      return { status: 'unchanged', rule: existing };
    }
    return {
      status: 'updated',
      rule: this.#repository.setActive(ruleId, this.#now())!,
    };
  }
}
