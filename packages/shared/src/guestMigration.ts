export interface GuestSavedMigrationCounts { destinationCount: number; attractionCount: number; }
export interface GuestMigrationReceipt {
  /** Legacy trip count, retained for existing clients. Saved counts include merged records. */
  importedCount: number;
  importedDestinationCount: number;
  importedAttractionCount: number;
  mergedDestinationCount: number;
  mergedAttractionCount: number;
}
export type GuestMigrationStatus =
  | { status: "none" }
  | { status: "discarded" }
  | { status: "expired" }
  | ({ status: "pending"; tripCount: number; expiresAt: string; busy: boolean } & GuestSavedMigrationCounts)
  | ({ status: "completed" } & GuestMigrationReceipt);
export interface GuestMigrationResult extends GuestMigrationReceipt { alreadyImported: boolean; }
