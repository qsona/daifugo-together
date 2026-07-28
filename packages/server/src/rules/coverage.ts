import type Database from 'better-sqlite3';

export function rulePrefectureCoverage(
  sqlite: Database.Database,
  includeRemoved: boolean,
): number {
  const visibleStatuses = includeRemoved
    ? "status IN ('active', 'removed')"
    : "status = 'active'";
  return (
    sqlite
      .prepare(
        `SELECT COUNT(DISTINCT prefecture) AS count
         FROM rules
         WHERE kind = 'local' AND prefecture IS NOT NULL
           AND ${visibleStatuses}`,
      )
      .get() as { count: number }
  ).count;
}
