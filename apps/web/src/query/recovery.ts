import type { Query, QueryClient } from "@tanstack/react-query";
import type { IdentitySession } from "@triply/shared";

const CHANNEL = "triply:mutable-data:v1";
const MESSAGE = "invalidate";
export const isMutableTripQuery = (query: Query) => {
  const key = query.queryKey;
  return key[0] === "trips" && (key.length <= 2 || key[2] === "budget");
};

/** Notifications contain no identity, trip ID, token or trip contents. */
export function installTripRecovery(client: QueryClient) {
  let channel: BroadcastChannel | undefined;
  try { channel = new BroadcastChannel(CHANNEL); } catch { /* Storage/focus fallback. */ }
  let stopped = false;
  let dirty = false;
  let running = false;
  let lastFocus = -Infinity;
  let sessionCheckedAtSignal = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let publishTimer: ReturnType<typeof setTimeout> | undefined;
  const identity = () => {
    const session = client.getQueryData<IdentitySession>(["auth", "session"]);
    return session?.status === "guest" ? `guest:${session.guest.id}`
      : session?.status === "authenticated" ? `user:${session.user.id}` : "anonymous";
  };
  const flush = async () => {
    timer = undefined;
    if (stopped || running || !dirty || document.visibilityState === "hidden" || client.isMutating()) return;
    dirty = false;
    running = true;
    const session = identity();
    try {
      await client.cancelQueries({ predicate: isMutableTripQuery });
      if (stopped) return;
      // Cookies may have changed in another tab (including guest import/login).
      const sessionState = client.getQueryState(["auth", "session"]);
      // AuthProvider also revalidates on focus. Join that read, or reuse its just-finished result.
      if (sessionState?.fetchStatus === "fetching" || (sessionState?.dataUpdatedAt ?? 0) <= sessionCheckedAtSignal) {
        await client.refetchQueries({ queryKey: ["auth", "session"], type: "active" }, { cancelRefetch: false });
      }
      if (stopped) return;
      if (identity() !== session) {
        // AuthProvider owns the transition and subsequent mounts. Do not fetch old keys.
        return;
      }
      if (client.isMutating()) { dirty = true; return; }
      await client.invalidateQueries({ predicate: isMutableTripQuery }, { cancelRefetch: false });
      void client.invalidateQueries({ queryKey: ["itinerary-candidates"], refetchType: "none" });
    } finally {
      running = false;
      if (dirty && !stopped && !client.isMutating()) schedule();
    }
  };
  const schedule = () => { if (!timer && !stopped) timer = setTimeout(() => void flush(), 100); };
  const receive = () => {
    dirty = true;
    sessionCheckedAtSignal = client.getQueryState(["auth", "session"])?.dataUpdatedAt ?? 0;
    void client.invalidateQueries({ predicate: isMutableTripQuery, refetchType: "none" });
    schedule();
  };
  const focus = () => {
    if (document.visibilityState === "hidden") return;
    if (dirty) { schedule(); return; }
    if (Date.now() - lastFocus < 10_000) return;
    lastFocus = Date.now();
    receive();
  };
  const storage = (event: StorageEvent) => { if (event.key === CHANNEL && event.newValue) receive(); };
  if (channel) channel.onmessage = event => { if (event.data === MESSAGE) receive(); };
  window.addEventListener("storage", storage);
  window.addEventListener("focus", focus);
  document.addEventListener("visibilitychange", focus);
  const unsubscribe = client.getMutationCache().subscribe(event => {
    if (event.type !== "updated") return;
    if (event.action.type === "pending") {
      void client.cancelQueries({ predicate: isMutableTripQuery });
    }
    if (event.action.type === "success" || event.action.type === "error") {
      // Include uncertain write acknowledgements. Receivers never rebroadcast reads.
      if (!publishTimer) publishTimer = setTimeout(() => {
        publishTimer = undefined;
        try {
          if (channel) channel.postMessage(MESSAGE);
          else { localStorage.setItem(CHANNEL, crypto.randomUUID()); localStorage.removeItem(CHANNEL); }
        } catch { /* Focus recovery still works in restricted browsers. */ }
      }, 100);
      if (dirty) schedule();
    }
  });
  return () => {
    stopped = true;
    clearTimeout(timer);
    clearTimeout(publishTimer);
    unsubscribe();
    channel?.close();
    window.removeEventListener("storage", storage);
    window.removeEventListener("focus", focus);
    document.removeEventListener("visibilitychange", focus);
  };
}
