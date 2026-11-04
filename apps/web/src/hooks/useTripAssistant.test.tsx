import { act, cleanup, renderHook } from "@testing-library/react";
import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { request } from "../api/client";
import { useTripAssistant } from "./useTripAssistant";
import i18n from "../i18n";
import { tripQueryKey } from "./useTrips";
import { equipmentQueryKey } from "./useTripEquipment";
import { packingContextQueryKey } from "./usePackingGeneration";
vi.mock("../api/client", () => ({ request: vi.fn() }));
afterEach(async () => { cleanup(); vi.clearAllMocks(); onlineManager.setOnline(true); await i18n.changeLanguage("en"); });
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(({ tripId }) => useTripAssistant(tripId, false), { initialProps: { tripId: "first" }, wrapper });
  return { client, ...hook };
}
it("refreshes domain caches after an uncertain confirmation outcome", async () => {
  const hook = setup();
  const keys = [tripQueryKey("first"), ["trips", "first", "budget"], equipmentQueryKey("first"), packingContextQueryKey("first"), ["itinerary-candidates", "first"], ["trips"], ["trip-assistant", "first"]];
  keys.forEach(key => hook.client.setQueryData(key, {}));
  vi.mocked(request).mockRejectedValueOnce(new TypeError("Lost committed response"));
  await act(async () => { await expect(hook.result.current.apply.mutateAsync("proposal")).rejects.toThrow("Lost committed response"); });
  keys.forEach(key => expect(hook.client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true));
  hook.client.clear();
});
it.each([
  { tripId: "another", requestId: "current", conversationId: "conversation" },
  { tripId: "first", requestId: "previous", conversationId: "conversation" },
  { tripId: "first", requestId: "current", conversationId: "another-conversation" },
])("rejects a response for the wrong trip, request or conversation: %j", async identity => {
  const hook = setup();
  vi.mocked(request).mockResolvedValueOnce({ ...identity, messages: [{ id: "foreign", role: "ai", text: "Wrong answer" }], response: { type: "message", message: "Wrong answer" } });
  await act(async () => { await expect(hook.result.current.send.mutateAsync({ message: "Current question", requestId: "current", conversationId: "conversation" })).rejects.toThrow("does not match"); });
  expect(hook.client.getQueryData(["trip-assistant", "first"])).toBeUndefined(); hook.client.clear();
});
it("cancels on a trip change and cannot cache a late result, even when the transport ignores cancellation", async () => {
  let finish!: (value: unknown) => void; let signal!: AbortSignal;
  vi.mocked(request).mockImplementationOnce((_url, init) => { signal = init!.signal as AbortSignal; return new Promise(done => { finish = done; }); });
  const hook = setup();
  let sent!: Promise<unknown>;
  await act(async () => { sent = hook.result.current.send.mutateAsync({ message: "Old trip" }).catch(error => error); });
  expect(signal.aborted).toBe(false);
  hook.rerender({ tripId: "second" }); expect(signal.aborted).toBe(true);
  await act(async () => { finish({ tripId: "first", conversationId: "old", messages: [{ id: "old", role: "ai", text: "Late result" }], response: { type: "message", message: "Late result" } }); await sent; });
  expect(hook.client.getQueryData(["trip-assistant", "first"])).toBeUndefined();
  expect(hook.client.getQueryData(["trip-assistant", "second"])).toBeUndefined();
  hook.client.clear();
});
it("prevents a second concurrent transport call and releases the send lock after completion", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(request).mockImplementationOnce(() => new Promise(done => { finish = done; }));
  const hook = setup(); let first!: Promise<unknown>;
  await act(async () => { first = hook.result.current.send.mutateAsync({ message: "First" }); });
  await act(async () => { await expect(hook.result.current.send.mutateAsync({ message: "Second" })).rejects.toThrow("Another message"); });
  expect(request).toHaveBeenCalledTimes(1);
  await act(async () => { finish({ tripId: "first", conversationId: "conversation", messages: [], response: { type: "message", message: "First answer" } }); await first; });
  vi.mocked(request).mockResolvedValueOnce({ tripId: "first", conversationId: "conversation", messages: [], response: { type: "message", message: "Next answer" } });
  await act(async () => { await hook.result.current.send.mutateAsync({ message: "Next" }); });
  expect(request).toHaveBeenCalledTimes(2); hook.client.clear();
});
it("fails promptly offline instead of leaving a paused mutation and permanent typing state", async () => {
  onlineManager.setOnline(false);
  vi.mocked(request).mockRejectedValueOnce(new TypeError("Offline"));
  const hook = setup();
  await act(async () => { await expect(hook.result.current.send.mutateAsync({ message: "Offline question" })).rejects.toThrow("Offline"); });
  expect(request).toHaveBeenCalledTimes(1);
  expect(hook.result.current.send.isPaused).toBe(false);
  hook.client.clear();
});
it("preserves a network retry's original locale and request identity across a UI language change", async () => {
  const hook = setup(); const input = { message: "Question", locale: "en" as const, requestId: "same-request-id" };
  vi.mocked(request).mockRejectedValueOnce(new Error("Network"));
  await act(async () => { await expect(hook.result.current.send.mutateAsync(input)).rejects.toThrow("Network"); });
  await act(() => i18n.changeLanguage("pl"));
  vi.mocked(request).mockResolvedValueOnce({ tripId: "first", requestId: input.requestId, conversationId: "conversation", messages: [], response: { type: "message", message: "Original reply" } });
  await act(async () => { await hook.result.current.send.mutateAsync(input); });
  const bodies = vi.mocked(request).mock.calls.map(call => JSON.parse(call[1]!.body as string));
  expect(bodies[0]).toEqual(bodies[1]); expect(bodies[1].locale).toBe("en"); hook.client.clear();
});
