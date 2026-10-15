import { useQuery } from "@tanstack/react-query";
import type { GuestUsage, IdentitySession } from "@triply/shared";
import { request } from "../api/client";
import { getSession } from "../api/auth";

export const GUEST_USAGE_KEY = ["guest", "usage"] as const;
export function useGuestUsage() {
  // Observe the existing session cache; there is no second identity state or request.
  const session = useQuery<IdentitySession>({ queryKey: ["auth", "session"], queryFn: getSession, enabled: false });
  const isGuest = session.data?.status === "guest";
  const usage = useQuery({ queryKey: GUEST_USAGE_KEY, queryFn: () => request<GuestUsage>("/api/guest/usage"),
    enabled: isGuest, staleTime: 10_000, retry: false, refetchInterval: isGuest ? 60_000 : false });
  return { ...usage, isGuest };
}
