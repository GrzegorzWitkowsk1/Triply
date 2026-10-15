import type { ProfileUser } from "./profile.js";

export interface GuestIdentity { id: string; expiresAt: string; }
export type IdentitySession =
  | { status: "anonymous"; reason?: "GUEST_SESSION_EXPIRED" }
  | { status: "guest"; guest: GuestIdentity }
  | { status: "authenticated"; user: ProfileUser };
