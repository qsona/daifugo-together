import type { RuleCatalogResponse } from '@daifugo/core';

export interface RuleCatalogFilters {
  prefecture?: string;
  status?: 'active' | 'removed';
  kind?: 'local' | 'original';
  limit?: number;
  offset?: number;
}

export interface RuleCatalogApi {
  list(filters?: RuleCatalogFilters): Promise<RuleCatalogResponse>;
}

export class RuleCatalogClient implements RuleCatalogApi {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(baseUrl: string, fetcher: typeof fetch = fetch) {
    this.#baseUrl = baseUrl;
    this.#fetch = fetcher;
  }

  async list(filters: RuleCatalogFilters = {}): Promise<RuleCatalogResponse> {
    const parameters = new URLSearchParams({ sort: 'recent', order: 'desc' });
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined) parameters.set(key, String(value));
    }
    const response = await this.#fetch(
      `${this.#baseUrl}/api/rules?${parameters.toString()}`,
    );
    if (!response.ok) throw new Error('rule_catalog_unavailable');
    return (await response.json()) as RuleCatalogResponse;
  }
}

let browserClient: RuleCatalogClient | undefined;

export function getBrowserRuleCatalogClient(): RuleCatalogClient {
  browserClient ??= new RuleCatalogClient(window.location.origin);
  return browserClient;
}
