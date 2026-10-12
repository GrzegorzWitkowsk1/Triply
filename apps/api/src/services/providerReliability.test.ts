import { describe, expect, it, vi, afterEach } from "vitest";
import { retryAfterMilliseconds, classifyExternalFailure } from "./providerReliability.js";
import { createOsrmProvider } from "../routing/providers/osrm.js";
import { fetchAttractions } from "./attractions.js";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("provider reliability", () => {
  it("parses Retry-After seconds and HTTP dates", () => {
    expect(retryAfterMilliseconds("2", 0)).toBe(2000);
    expect(retryAfterMilliseconds("Thu, 01 Jan 1970 00:00:03 GMT", 0)).toBe(3000);
    expect(retryAfterMilliseconds("invalid", 0)).toBe(0);
    expect(retryAfterMilliseconds(null)).toBe(0);
  });
  it.each([[429, "rate_limit"], [401, "configuration"], [403, "configuration"], [400, "invalid_input"], [500, "temporary_provider"], [502, "temporary_provider"], [503, "temporary_provider"]] as const)("classifies HTTP %s", (status, category) => {
    expect(classifyExternalFailure(status)).toBe(category);
  });
  it("distinguishes cancellation, timeout and network errors", () => {
    expect(classifyExternalFailure(undefined, new DOMException("timeout", "TimeoutError"))).toBe("timeout");
    expect(classifyExternalFailure(undefined, new DOMException("cancel", "AbortError"))).toBe("cancelled");
    expect(classifyExternalFailure(undefined, new TypeError("network"))).toBe("temporary_provider");
  });
  it("does not retry routing before Retry-After exceeds its budget", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 429, headers: { "Retry-After": "60" } }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createOsrmProvider({ baseUrl: "https://routing.example", supportedModes: ["walking"], timeoutMs: 100, totalBudgetMs: 1000, backoffMs: [0, 0] });
    await expect(provider.getTravelMatrix([{ lat: 48.85, lng: 2.35 }, { lat: 48.86, lng: 2.35 }], "walking")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("honors provider cooldown while allowing Overpass fallback", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "60" } })).mockResolvedValueOnce(new Response('{"elements":[]}'));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchAttractions(48.85, 2.35, ["culture"], { endpoints: ["https://one.example", "https://two.example"], totalBudgetMs: 1000, backoffMs: [0] })).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("does not retry cancelled routing requests", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new DOMException("cancel", "AbortError")); vi.stubGlobal("fetch", fetchMock);
    const provider = createOsrmProvider({ baseUrl: "https://routing.example", supportedModes: ["walking"], timeoutMs: 100, backoffMs: [0, 0] });
    await expect(provider.getTravelMatrix([{ lat: 48.85, lng: 2.35 }, { lat: 48.86, lng: 2.35 }], "walking")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
