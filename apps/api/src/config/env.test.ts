import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("routing environment defaults", () => {
  it("defaults Geoapify to 2500 credits and permits a missing key", async () => {
    for (const key of ["GEOAPIFY_API_KEY", "GEOAPIFY_DAILY_CREDIT_LIMIT", "GEOAPIFY_ENABLED"]) vi.stubEnv(key, undefined);
    vi.resetModules();
    const { env } = await import("./env.js");
    expect(env.GEOAPIFY_DAILY_CREDIT_LIMIT).toBe(2500);
    expect(env.GEOAPIFY_ENABLED).toBe(true);
    expect(env.GEOAPIFY_API_KEY).toBeNull();
  });
  it.each(["0", "-1", "1.5", "abc"])("rejects invalid Geoapify credit limit %s", async value => {
    vi.stubEnv("GEOAPIFY_DAILY_CREDIT_LIMIT", value);
    vi.resetModules();
    await expect(import("./env.js")).rejects.toThrow("Invalid environment configuration");
  });
  it("enables a real pedestrian endpoint for the default walking travel mode", async () => {
    for (const key of ["ROUTING_OSRM_URL", "ROUTING_OSRM_PROFILE", "ROUTING_ENABLED_MODES", "ROUTING_MODE"]) {
      vi.stubEnv(key, undefined);
    }
    vi.resetModules();
    const { env } = await import("./env.js");
    expect(env.ROUTING_OSRM_URL).toBe("https://routing.openstreetmap.de/routed-foot");
    expect(env.ROUTING_OSRM_PROFILE).toBe("driving");
    expect(env.ROUTING_MODE).toBe("walking");
    expect(env.ROUTING_ENABLED_MODES).toContain(env.ROUTING_MODE);
  });

  it("preserves explicit custom OSRM endpoint, profile and travel mode settings", async () => {
    vi.stubEnv("ROUTING_OSRM_URL", "https://routing.test/bicycle");
    vi.stubEnv("ROUTING_OSRM_PROFILE", "bike");
    vi.stubEnv("ROUTING_ENABLED_MODES", "cycling");
    vi.stubEnv("ROUTING_MODE", "cycling");
    vi.resetModules();
    const { env } = await import("./env.js");
    expect(env.ROUTING_OSRM_URL).toBe("https://routing.test/bicycle");
    expect(env.ROUTING_OSRM_PROFILE).toBe("bike");
    expect(env.ROUTING_MODE).toBe("cycling");
    expect(env.ROUTING_ENABLED_MODES).toEqual(["cycling"]);
  });
});
