import { afterEach, describe, expect, it, vi } from "vitest";
import { tripLocationSchema } from "@triply/shared";
import { geocodeLocation, resolveDestination } from "./location.js";

afterEach(() => vi.unstubAllGlobals());

const prague = { name: "Prague", country: "Czechia", country_code: "CZ", latitude: 50.08, longitude: 14.43 };
function provider(results: unknown[]) {
  const mock = vi.fn(async (_url: string) => new Response(JSON.stringify({ results })));
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("destination resolution", () => {
  it("searches the city alone and accepts the legacy Czech Republic country name", async () => {
    const fetch = provider([prague, { ...prague, country: "United States", country_code: "US" }]);
    expect(await geocodeLocation("Prague, Czech Republic")).toEqual({ lat: 50.08, lng: 14.43, city: "Prague", country: "Czechia" });
    const url = new URL(fetch.mock.calls[0]![0]);
    expect(url.searchParams.get("name")).toBe("Prague");
    expect(url.searchParams.get("count")).toBe("100");
  });

  it("accepts zero coordinates and country codes", async () => {
    provider([{ ...prague, latitude: 0, longitude: 0 }]);
    expect(await resolveDestination("Prague", "CZ")).toMatchObject({ lat: 0, lng: 0 });
  });

  it("shares simultaneous requests", async () => {
    const fetch = provider([prague]);
    await Promise.all([resolveDestination("Prague", "Czechia"), resolveDestination("Prague", "Czech Republic")]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects ambiguity rather than choosing the first result", async () => {
    provider([prague, { ...prague, longitude: 15 }]);
    await expect(resolveDestination("Prague", "Czechia")).rejects.toThrow("more than one city");
  });

  it.each([{ results: [] }, { results: [{ ...prague, name: "Brno" }] }, { results: [{ ...prague, country: "France", country_code: "FR" }] }])(
    "rejects absent or unrelated matches (%j)", async ({ results }) => {
      provider(results);
      await expect(resolveDestination("Prague", "Czechia")).rejects.toThrow("couldn't determine");
    },
  );

  it.each([null, "50", 91, -91])("rejects invalid provider latitude %s", async (latitude) => {
    provider([{ ...prague, latitude }]);
    await expect(resolveDestination("Prague", "Czechia")).rejects.toThrow("invalid coordinates");
  });

  it.each([181, -181])("rejects invalid provider longitude %s", async (longitude) => {
    provider([{ ...prague, longitude }]);
    await expect(resolveDestination("Prague", "Czechia")).rejects.toThrow("invalid coordinates");
  });

  it.each([NaN, Infinity, -Infinity])("rejects nonfinite contract coordinates %s", (lat) => {
    expect(tripLocationSchema.safeParse({ lat, lng: 0 }).success).toBe(false);
  });

  it.each(["http", "network", "malformed", "timeout"])("reports provider failures (%s) without unbounded retries", async (failure) => {
    const fetch = vi.fn(async () => {
      if (failure === "network") throw new Error("internal secret");
      if (failure === "timeout") throw new DOMException("Timed out", "TimeoutError");
      return failure === "http" ? new Response("error", { status: 503 }) : new Response("{");
    });
    vi.stubGlobal("fetch", fetch);
    await expect(resolveDestination("Prague", "Czechia")).rejects.toMatchObject({ status: 503, message: "Destination lookup is temporarily unavailable. Please try again." });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
