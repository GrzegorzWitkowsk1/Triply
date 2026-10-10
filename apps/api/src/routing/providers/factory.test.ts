import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoutingProvider, type RoutingProviderConfig } from "./factory.js";

function config(overrides: Partial<RoutingProviderConfig> = {}): RoutingProviderConfig {
  return {
    ROUTING_PROVIDER: "osrm",
    ROUTING_OSRM_URL: "https://osrm.test",
    ROUTING_ENABLED_MODES: ["driving"],
    ROUTING_TIMEOUT_MS: 8_000,
    ...overrides,
  };
}

describe("createRoutingProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("passes the pedestrian endpoint and URL profile to the existing OSRM adapter", async () => {
    const fetchMock = vi.fn(async (_url: string) => Response.json({ code: "Ok", durations: [[0, 100], [100, 0]], distances: [[0, 125], [125, 0]] }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createRoutingProvider(config({
      ROUTING_OSRM_URL: "https://foot.osrm.test/routed-foot", ROUTING_OSRM_PROFILE: "driving", ROUTING_ENABLED_MODES: ["walking"],
    }));
    await provider!.getTravelMatrix([{ lat: 48.85, lng: 2.35 }, { lat: 48.86, lng: 2.36 }], "walking");
    expect(provider!.supportsMode("walking")).toBe(true);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/routed-foot/table/v1/driving/");
  });

  it("creates an OSRM provider with the configured modes", () => {
    const provider = createRoutingProvider(config());

    expect(provider).not.toBeNull();
    expect(provider?.name).toBe("osrm");
    expect(provider?.supportedModes).toEqual(["driving"]);
    expect(provider?.supportsMode("driving")).toBe(true);
    expect(provider?.supportsMode("walking")).toBe(false);
  });

  it("returns null when routing is disabled", () => {
    expect(createRoutingProvider(config({ ROUTING_PROVIDER: "none" }))).toBeNull();
  });

  it("throws for an unknown provider", () => {
    expect(() => createRoutingProvider(config({ ROUTING_PROVIDER: "graphhopper" }))).toThrow(
      /Unsupported ROUTING_PROVIDER/,
    );
  });
});
