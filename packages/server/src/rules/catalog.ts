import type { RuleCatalogResponse } from '@daifugo/core';

import type { RuleCatalogQuery, RuleCatalogResult } from './repository.js';

export interface RuleCatalogPort {
  catalog(query: RuleCatalogQuery): RuleCatalogResult;
}

type CatalogHttpResult =
  | { status: 200; body: RuleCatalogResponse }
  | { status: 400; body: { error: 'invalid_query'; field: string } };

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

  constructor(rules: RuleCatalogPort) {
    this.#rules = rules;
  }

  list(parameters: URLSearchParams): CatalogHttpResult {
    const prefecture = single(parameters, 'prefecture');
    const status = single(parameters, 'status');
    const kind = single(parameters, 'kind');
    const sort = single(parameters, 'sort');
    const order = single(parameters, 'order');
    const limit = integer(single(parameters, 'limit') ?? undefined, 30);
    const offset = integer(single(parameters, 'offset') ?? undefined, 0);
    const invalidField =
      prefecture === null
        ? 'prefecture'
        : status === null ||
            (status !== undefined && !['active', 'removed'].includes(status))
          ? 'status'
          : kind === null ||
              (kind !== undefined && !['local', 'original'].includes(kind))
            ? 'kind'
            : sort === null || (sort !== undefined && sort !== 'recent')
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
    const result = this.#rules.catalog({
      ...(prefecture ? { prefecture } : {}),
      ...(status ? { status: status as 'active' | 'removed' } : {}),
      ...(kind ? { kind: kind as 'local' | 'original' } : {}),
      order: (order ?? 'desc') as 'asc' | 'desc',
      limit: limit!,
      offset: offset!,
    });
    return {
      status: 200,
      body: {
        summary: result.summary,
        page: { total: result.total, limit: limit!, offset: offset! },
        items: result.items.map((rule) => ({
          id: rule.id,
          name: rule.name,
          description: rule.description,
          kind: rule.kind,
          prefecture: rule.prefecture,
          status: rule.status as 'active' | 'removed',
          priority: null,
          popularity: null,
          implementedAt: rule.createdAt,
          removedAt: rule.status === 'removed' ? rule.updatedAt : null,
        })),
      },
    };
  }
}
