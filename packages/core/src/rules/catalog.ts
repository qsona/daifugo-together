export type RuleCatalogStatus = 'active' | 'removed';
export type RuleCatalogKind = 'local' | 'original';

export interface RuleCatalogItem {
  id: string;
  name: string;
  description: string | null;
  kind: RuleCatalogKind;
  prefecture: string | null;
  status: RuleCatalogStatus;
  priority: number | null;
  popularity: number | null;
  implementedAt: string;
  removedAt: string | null;
}

export interface RuleCatalogSummary {
  implemented: number;
  active: number;
  removed: number;
}

export interface RuleCatalogResponse {
  summary: RuleCatalogSummary;
  page: {
    total: number;
    limit: number;
    offset: number;
  };
  items: RuleCatalogItem[];
}
