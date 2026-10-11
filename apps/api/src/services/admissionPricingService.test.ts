import { describe, expect, it } from "vitest";
import { normalizeAdmission, preferAdmission } from "./admissionPricingService.js";
describe("admission normalization", () => {
  const normalize = (tags: Record<string, unknown>) => normalizeAdmission({ tourism: "museum", ...tags }, "2026-10-11T00:00:00Z");
  it.each([
    [{ fee: "no" }, "free", null], [{ fee: "yes" }, "paid", null], [{}, "unknown", null],
    [{ fee: "yes", charge: "12 EUR" }, "paid", 1200],
    [{ fee: "yes", charge: "8,50 USD/person" }, "paid", 850],
    [{ charge: "£12" }, "paid", 1200], [{ charge: "12", currency: "EUR" }, "paid", 1200],
    [{ charge: "500 JPY" }, "paid", 500], [{ charge: "1.250 KWD" }, "paid", 1250],
    [{ fee: "yes", charge: "12 XYZ" }, "paid", null], [{ charge: "12" }, "unknown", null],
    [{ fee: "yes", charge: "garbage" }, "paid", null], [{ fee: "yes", charge: "10-20 EUR" }, "paid", null],
    [{ fee: "yes", charge: "$12" }, "paid", null], [{ charge: "12 EUR/hour" }, "unknown", null],
    [{ charge: "12 EUR/day" }, "unknown", null], [{ fee: "no", charge: "12 EUR" }, "unknown", null],
    [{ fee: "yes", charge: "12 EUR", "charge:conditional": "0 @ (Mo)" }, "unknown", null],
    [{ fee: "no", "fee:conditional": "yes @ (Sa)" }, "unknown", null],
    [{ charge: "12 EUR", currency: "USD" }, "unknown", null],
    [{ charge: "12 EUR", tourism: "", amenity: "parking" }, "unknown", null],
    [{ charge: "12 EUR", tourism: "", amenity: "restaurant" }, "unknown", null],
  ])("normalizes %j conservatively", (tags, status, amountMinor) => {
    const result = normalize(tags);
    expect(result.status).toBe(status);
    expect(result.price?.amountMinor ?? null).toBe(amountMinor);
    expect(result.rawCharge).toBe((tags as Record<string, unknown>).charge ?? null);
  });
  it("retains units and retrieval provenance independently of verification", () => {
    expect(normalize({ charge: "12 EUR" }).price?.unit).toBe("unknown");
    expect(normalize({ charge: "12 EUR/group" }).price?.unit).toBe("per_group");
    expect(normalize({ charge: "12 EUR/person" })).toMatchObject({ retrievedAt: "2026-10-11T00:00:00Z", checkedAt: null });
  });
  it("preserves verified official evidence", () => {
    const official = { ...normalize({ charge: "12 EUR" }), source: "official" as const, checkedAt: "2026-10-10" };
    expect(preferAdmission(official, normalize({ fee: "no" }))).toBe(official);
  });
  it("does not choose a precise price between conflicting duplicate evidence", () => {
    expect(preferAdmission(normalize({ charge: "12 EUR" }), normalize({ charge: "14 EUR" })).price).toBeNull();
  });
  it("retains conditional evidence when duplicate features have an unconditional price", () => {
    const conditional = normalize({ "fee:conditional": "yes @ (Sa)" });
    const exact = normalize({ charge: "12 EUR" });
    expect(preferAdmission(exact, conditional)).toMatchObject({ status: "unknown", price: null, rawFeeConditional: "yes @ (Sa)" });
    expect(preferAdmission(conditional, exact)).toMatchObject({ status: "unknown", price: null });
  });
});
