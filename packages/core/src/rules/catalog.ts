export type RuleCatalogStatus = 'active' | 'removed';
export type RuleCatalogKind = 'local' | 'original';

export interface RuleCatalogItem {
  id: string;
  name: string;
  description: string;
  kind: RuleCatalogKind;
  prefecture: string | null;
  status: RuleCatalogStatus;
  priority: null;
  popularity: null;
  implementedAt: number;
  removedAt: number | null;
}

export interface RuleCatalogSummary {
  implemented: number;
  active: number;
  removed: number;
  prefectureCoverage: number;
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
