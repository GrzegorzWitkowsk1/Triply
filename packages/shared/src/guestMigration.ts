export type GuestMigrationStatus =
  | { status: "none" }
  | { status: "discarded" }
  | { status: "expired" }
  | { status: "pending"; tripCount: number; expiresAt: string; busy: boolean }
  | { status: "completed"; importedCount: number };
export interface GuestMigrationResult { importedCount: number; alreadyImported: boolean; }
