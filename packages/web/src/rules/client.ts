import type { RuleCatalogItem, RuleCatalogResponse } from '@daifugo/core';

export interface RuleCatalogFilters {
  status?: 'active' | 'removed';
  kind?: 'local' | 'original';
  limit?: number;
  offset?: number;
  sort?: 'recent' | 'priority' | 'popularity';
  order?: 'asc' | 'desc';
}

export interface RuleCatalogApi {
  list(filters?: RuleCatalogFilters): Promise<RuleCatalogResponse>;
  get(ruleId: string): Promise<RuleCatalogItem>;
}

export class RuleCatalogClient implements RuleCatalogApi {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(baseUrl: string, fetcher: typeof fetch = fetch) {
    this.#baseUrl = baseUrl;
    // Window.fetch を RuleCatalogClient のメソッドとして呼ばないようにする。
    this.#fetch = (...args) => fetcher(...args);
  }

  async list(filters: RuleCatalogFilters = {}): Promise<RuleCatalogResponse> {
    const parameters = new URLSearchParams({
      sort: filters.sort ?? 'recent',
      order: filters.order ?? 'desc',
    });
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined) parameters.set(key, String(value));
    }
    const response = await this.#fetch(
      `${this.#baseUrl}/api/rules?${parameters.toString()}`,
    );
    if (!response.ok) throw new Error('rule_catalog_unavailable');
    return (await response.json()) as RuleCatalogResponse;
  }

  async get(ruleId: string): Promise<RuleCatalogItem> {
    const response = await this.#fetch(
      `${this.#baseUrl}/api/rules/${encodeURIComponent(ruleId)}`,
    );
    if (!response.ok) throw new Error('rule_catalog_unavailable');
    return (await response.json()) as RuleCatalogItem;
  }
}

let browserClient: RuleCatalogClient | undefined;

export function getBrowserRuleCatalogClient(): RuleCatalogClient {
  browserClient ??= new RuleCatalogClient(window.location.origin);
  return browserClient;
}
