import type { GuestMigrationResult, GuestMigrationStatus } from "@triply/shared";
import { request } from "./client";

export const getGuestMigration = () => request<GuestMigrationStatus>("/api/auth/guest-migration/status", { cache: "no-store" });
export const confirmGuestMigration = () => request<GuestMigrationResult>("/api/auth/guest-migration/confirm", { method: "POST" });
export const discardGuestMigration = () => request<GuestMigrationStatus>("/api/auth/guest-migration/discard", { method: "POST" });
