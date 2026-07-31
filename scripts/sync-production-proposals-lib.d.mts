export const SYNC_FORMAT_VERSION: 1;
export const LOCAL_GOD_USER: Readonly<{
  user_id: string;
  user_token: string;
  display_name: string;
  google_sub: string;
  registered_at: number;
  proposals_seen_at: number;
  proposal_suspended_until: null;
  created_at: number;
}>;
export const SYNC_TABLES: readonly string[];

export function validatePayload(payload: unknown): {
  formatVersion: 1;
  tables: Record<string, Array<Record<string, unknown>>>;
};

export function importProposalData(
  database: unknown,
  payload: unknown,
): Record<string, number>;

export function installDatabaseFile(
  tempPath: string,
  targetPath: string,
): string | null;

export function productionExporterSource(sourceDatabasePath: string): string;
