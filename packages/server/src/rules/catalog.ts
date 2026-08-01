import type { RuleCatalogItem, RuleCatalogResponse } from '@daifugo/core';

import type { RuleCatalogQuery, RuleCatalogResult } from './repository.js';

/** 一覧の 1 件と同じ形。by-id もこれを受け取る。 */
export type RuleCatalogEntry = RuleCatalogResult['items'][number];

export interface RuleCatalogPort {
  catalog(query: RuleCatalogQuery): RuleCatalogResult;
  catalogItem(ruleId: string): RuleCatalogEntry | null;
}

type CatalogHttpResult =
  | { status: 200; body: RuleCatalogResponse }
  | { status: 400; body: { error: 'invalid_query'; field: string } };

type CatalogDetailHttpResult =
  | { status: 200; body: RuleCatalogItem }
  | { status: 404; body: { error: 'rule_not_found' } };

function single(
  parameters: URLSearchParams,
  name: string,
): string | undefined | null {
  const values = parameters.getAll(name);
  if (values.length > 1) return null;
  return values[0];
}

function integer(value: string | undefined, fallback: number): number | null {
  if (value === undefined) return fallback;
  if (!/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export class RuleCatalogService {
  readonly #rules: RuleCatalogPort;
  readonly #eliminationEnabled: boolean;
  readonly #priorityEnabled: boolean;
  readonly #popularityEnabled: boolean;

  constructor(
    rules: RuleCatalogPort,
    options: {
      eliminationEnabled?: boolean;
      priorityEnabled?: boolean;
      popularityEnabled?: boolean;
    } = {},
  ) {
    this.#rules = rules;
    this.#eliminationEnabled = options.eliminationEnabled ?? false;
    this.#priorityEnabled = options.priorityEnabled ?? false;
    this.#popularityEnabled = options.popularityEnabled ?? false;
  }

  list(parameters: URLSearchParams): CatalogHttpResult {
    const status = single(parameters, 'status');
    const kind = single(parameters, 'kind');
    const sort = single(parameters, 'sort');
    const order = single(parameters, 'order');
    const limit = integer(single(parameters, 'limit') ?? undefined, 30);
    const offset = integer(single(parameters, 'offset') ?? undefined, 0);
    const invalidField =
      status === null ||
      (status !== undefined && !['active', 'removed', 'all'].includes(status))
        ? 'status'
        : kind === null ||
            (kind !== undefined && !['local', 'original'].includes(kind))
          ? 'kind'
          : sort === null ||
              (sort !== undefined &&
                !['recent', 'priority', 'popularity'].includes(sort))
            ? 'sort'
            : order === null ||
                (order !== undefined && !['asc', 'desc'].includes(order))
              ? 'order'
              : limit === null || limit < 1 || limit > 100
                ? 'limit'
                : offset === null || offset < 0
                  ? 'offset'
                  : null;
    if (invalidField) {
      return {
        status: 400,
        body: { error: 'invalid_query', field: invalidField },
      };
    }
    if (
      (sort === 'priority' && !this.#priorityEnabled) ||
      (sort === 'popularity' && !this.#popularityEnabled)
    ) {
      return {
        status: 400,
        body: { error: 'invalid_query', field: 'sort' },
      };
    }
    const result = this.#rules.catalog({
      includeRemoved: this.#eliminationEnabled,
      ...(status && status !== 'all'
        ? { status: status as 'active' | 'removed' }
        : {}),
      ...(kind ? { kind: kind as 'local' | 'original' } : {}),
      sort: (sort ?? 'recent') as 'recent' | 'priority' | 'popularity',
      order: (order ?? 'desc') as 'asc' | 'desc',
      limit: limit!,
      offset: offset!,
    });
    return {
      status: 200,
      body: {
        summary: result.summary,
        page: { total: result.total, limit: limit!, offset: offset! },
        items: result.items.map((rule) => this.#item(rule)),
      },
    };
  }

  detail(ruleId: string): CatalogDetailHttpResult {
    const rule = this.#rules.catalogItem(ruleId);
    // disabled は未公開。存在しない扱いにする。
    if (!rule || (rule.status !== 'active' && rule.status !== 'removed')) {
      return { status: 404, body: { error: 'rule_not_found' } };
    }
    return { status: 200, body: this.#item(rule) };
  }

  #item(rule: RuleCatalogEntry): RuleCatalogItem {
    return {
      id: rule.id,
      name: rule.name,
      description: rule.description,
      kind: rule.kind,
      prefecture: rule.prefecture,
      status: rule.status as 'active' | 'removed',
      priority: this.#priorityEnabled ? rule.priorityRank : null,
      popularity: this.#popularityEnabled
        ? Math.round(rule.popularityScore * 100)
        : null,
      implementedAt: new Date(rule.createdAt).toISOString(),
      removedAt:
        rule.status === 'removed'
          ? new Date(rule.updatedAt).toISOString()
          : null,
    };
  }
}
