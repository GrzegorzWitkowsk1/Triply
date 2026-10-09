import { describe, expect, it } from "vitest";
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
