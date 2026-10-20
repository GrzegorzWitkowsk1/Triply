import { afterEach, expect, it, vi } from "vitest";
import { requestWithTimeout } from "./client";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it("bounds a slow request and exposes a safe retryable timeout", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn((_path: string, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  })));
  const result = expect(requestWithTimeout("/api/destinations", {}, 100)).rejects.toMatchObject({ status: 408, message: "The request timed out. Please retry." });
  await vi.advanceTimersByTimeAsync(101); await result;
});
it("propagates query cancellation and clears the request timer", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn((_path: string, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  })));
  const controller = new AbortController();
  const result = expect(requestWithTimeout("/api/destinations", { signal: controller.signal }, 100)).rejects.toMatchObject({ name: "AbortError" });
  controller.abort(); await result; expect(vi.getTimerCount()).toBe(0);
});
