export interface FeatureFlags {
  priority: boolean;
  popularity: boolean;
  elimination: boolean;
  ruleDex: boolean;
}

function enabled(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === 'true';
}

export const FEATURES: FeatureFlags = {
  priority: enabled(import.meta.env.VITE_FEATURE_PRIORITY, true),
  popularity: enabled(import.meta.env.VITE_FEATURE_POPULARITY, true),
  elimination: enabled(import.meta.env.VITE_FEATURE_ELIMINATION, true),
  ruleDex: enabled(import.meta.env.VITE_FEATURE_RULE_DEX, true),
};
