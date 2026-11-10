import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { createElement, StrictMode } from "react";
import { cleanup, render } from "@testing-library/react";
import { installTripRecovery } from "./recovery";
import { TripRecovery } from "./TripRecovery";

class TestChannel {
  static channels = new Set<TestChannel>();
  static sent: unknown[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  constructor(readonly name: string) { TestChannel.channels.add(this); }
  postMessage(data: unknown) {
    TestChannel.sent.push(data);
    for (const channel of TestChannel.channels) if (channel !== this && channel.name === this.name) channel.onmessage?.({ data });
  }
  close() { TestChannel.channels.delete(this); }
}
const disposers: (() => void)[] = [];
function tab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  disposers.push(() => client.clear());
  const stop = installTripRecovery(client);
  disposers.push(stop);
  return { client, stop };
}
function observe(client: QueryClient, key: readonly unknown[], fn: () => Promise<unknown>, initialData: unknown = "old") {
  const observer = new QueryObserver(client, { queryKey: key, queryFn: fn, initialData });
  const unsubscribe = observer.subscribe(() => {});
  disposers.push(unsubscribe);
  return observer;
}
async function flush() { await vi.advanceTimersByTimeAsync(100); }
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("BroadcastChannel", TestChannel);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  TestChannel.sent = [];
});
afterEach(() => { cleanup(); disposers.splice(0).reverse().forEach(dispose => dispose()); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("A: revalidates only mutable observed queries on focus, coalescing focus/visibility events", async () => {
  const { client } = tab();
  const trip = vi.fn(async () => "authoritative");
  const budget = vi.fn(async () => ({ revision: 2, expenses: ["ticket"] }));
  const catalog = vi.fn(async () => "catalog");
  observe(client, ["trips", "trip"], trip);
  observe(client, ["trips", "trip", "budget"], budget);
  observe(client, ["destinations"], catalog);
  const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  window.dispatchEvent(new Event("focus")); await flush(); expect(trip).not.toHaveBeenCalled();
  hidden.mockReturnValue("visible");
  document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("focus")); await flush();
  expect(client.getQueryData(["trips", "trip"])).toBe("authoritative");
  expect(trip).toHaveBeenCalledTimes(1); expect(budget).toHaveBeenCalledTimes(1); expect(catalog).not.toHaveBeenCalled();
  window.dispatchEvent(new Event("focus")); await flush(); expect(trip).toHaveBeenCalledTimes(1);
});

it("reproduces the disabled-focus baseline and recovers the same stale query after installing recovery", async () => {
  const client = new QueryClient({ defaultOptions: { queries: {
    staleTime: 60_000, retry: false, refetchOnWindowFocus: false, refetchOnMount: false, gcTime: Infinity,
  } } });
  disposers.push(() => client.clear());
  const read = vi.fn(async () => "changed elsewhere");
  observe(client, ["trips", "trip"], read);
  await client.invalidateQueries({ queryKey: ["trips"], refetchType: "none" });
  window.dispatchEvent(new Event("focus")); await flush();
  expect(client.getQueryData(["trips", "trip"])).toBe("old"); expect(read).not.toHaveBeenCalled();
  const stop = installTripRecovery(client); disposers.push(stop);
  window.dispatchEvent(new Event("focus")); await flush();
  expect(client.getQueryData(["trips", "trip"])).toBe("changed elsewhere"); expect(read).toHaveBeenCalledTimes(1);
});

it("B/C: a mutation in one tab converges the other Budget once with payload-free messages and no echo", async () => {
  const a = tab(); const b = tab();
  const budget = vi.fn(async () => ({ revision: 7, expenses: [{ id: "ticket" }], total: 2500 }));
  observe(b.client, ["trips", "trip", "budget"], budget);
  await a.client.getMutationCache().build(a.client, { mutationFn: async () => ({ secret: "private trip/token" }) }).execute(undefined);
  await flush(); await flush();
  expect(b.client.getQueryData(["trips", "trip", "budget"])).toEqual({ revision: 7, expenses: [{ id: "ticket" }], total: 2500 });
  expect(budget).toHaveBeenCalledTimes(1); expect(TestChannel.sent).toEqual(["invalidate"]);
});

it("E: cancels an older read, defers incoming recovery until mutation settles, then reads authoritative state", async () => {
  const a = tab(); const b = tab();
  let releaseRead!: (value: unknown) => void;
  let releaseMutation!: () => void;
  const query = vi.fn().mockImplementationOnce(() => new Promise(resolve => { releaseRead = resolve; }))
    .mockResolvedValue({ revision: 3, expenses: ["new authoritative"] });
  observe(b.client, ["trips", "trip", "budget"], query, { revision: 1 });
  const read = b.client.refetchQueries({ queryKey: ["trips", "trip", "budget"] });
  const mutation = b.client.getMutationCache().build(b.client, {
    mutationFn: () => new Promise<void>(resolve => { releaseMutation = resolve; }),
    onMutate: () => { b.client.setQueryData(["trips", "trip", "budget"], { revision: 2, expenses: ["optimistic"] }); },
  }).execute(undefined);
  await Promise.resolve(); await Promise.resolve();
  for (const channel of TestChannel.channels) if (channel !== [...TestChannel.channels][0]) channel.onmessage?.({ data: "invalidate" });
  window.dispatchEvent(new Event("focus")); await flush();
  releaseRead({ revision: 1, expenses: ["old"] }); await read;
  expect(b.client.getQueryData(["trips", "trip", "budget"])).toEqual({ revision: 2, expenses: ["optimistic"] });
  expect(query).toHaveBeenCalledTimes(1);
  releaseMutation(); await mutation; await flush();
  expect(b.client.getQueryData(["trips", "trip", "budget"])).toEqual({ revision: 3, expenses: ["new authoritative"] });
  expect(query).toHaveBeenCalledTimes(2);
  void a;
});

it("defers hidden-tab notifications until visible and falls back to storage when channels are unavailable", async () => {
  vi.stubGlobal("BroadcastChannel", undefined);
  const { client } = tab(); const query = vi.fn(async () => "new");
  observe(client, ["trips", "trip"], query);
  const visible = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  window.dispatchEvent(new StorageEvent("storage", { key: "triply:mutable-data:v1", newValue: "nonce" }));
  await flush(); expect(query).not.toHaveBeenCalled();
  visible.mockReturnValue("visible"); document.dispatchEvent(new Event("visibilitychange")); await flush();
  expect(query).toHaveBeenCalledTimes(1);
});

it("H: cleanup removes channels, listeners, subscriptions and queued triggers", async () => {
  const { client, stop } = tab(); const query = vi.fn(async () => "new"); observe(client, ["trips", "trip"], query);
  window.dispatchEvent(new Event("focus"));
  stop(); expect(TestChannel.channels.size).toBe(0);
  window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange"));
  window.dispatchEvent(new StorageEvent("storage", { key: "triply:mutable-data:v1", newValue: "nonce" }));
  await client.getMutationCache().build(client, { mutationFn: async () => true }).execute(undefined);
  await vi.runOnlyPendingTimersAsync();
  expect(query).not.toHaveBeenCalled(); expect(TestChannel.sent).toEqual([]);
});

it("joins an in-flight session check and does not read trip data after the identity changes", async () => {
  const { client } = tab();
  let release!: (session: unknown) => void;
  const session = vi.fn(() => new Promise(resolve => { release = resolve; }));
  observe(client, ["auth", "session"], session, { status: "guest", guest: { id: "old-guest" } });
  const trip = vi.fn(async () => "private"); observe(client, ["trips", "trip"], trip);
  const checking = client.refetchQueries({ queryKey: ["auth", "session"] });
  window.dispatchEvent(new Event("focus")); await flush();
  expect(session).toHaveBeenCalledTimes(1);
  release({ status: "authenticated", user: { id: "new-user" } });
  await checking; await flush();
  expect(trip).not.toHaveBeenCalled();
});

it("H: StrictMode provider unmount leaves no listeners, channels or queued reads", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, refetchOnWindowFocus: false, gcTime: Infinity } } });
  disposers.push(() => client.clear());
  const query = vi.fn(async () => "fresh"); observe(client, ["trips", "trip"], query);
  const view = render(createElement(StrictMode, null,
    createElement(QueryClientProvider, { client }, createElement(TripRecovery))));
  expect(TestChannel.channels.size).toBe(1);
  window.dispatchEvent(new Event("focus"));
  view.unmount(); expect(TestChannel.channels.size).toBe(0);
  window.dispatchEvent(new Event("focus"));
  await vi.runOnlyPendingTimersAsync();
  expect(query).not.toHaveBeenCalled();
});
