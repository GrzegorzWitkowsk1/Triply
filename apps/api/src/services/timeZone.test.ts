import { describe, expect, it } from "vitest";
import { isValidTimeZone, offsetMinutes, resolveLocalIso, weekdayForDate } from "./timeZone.js";

describe("isValidTimeZone", () => {
  it("accepts IANA zone names", () => {
    expect(isValidTimeZone("Europe/Warsaw")).toBe(true);
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
  });

  it("rejects unknown or empty zones", () => {
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
  });
});

describe("resolveLocalIso", () => {
  it("returns the wall-clock time on a normal day", () => {
    const result = resolveLocalIso("2026-06-01", 10 * 60, "Europe/Warsaw");

    expect(result.iso).toBe("2026-06-01T10:00:00");
    expect(result.adjusted).toBe(false);
    expect(result.skippedMinutes).toBe(0);
  });

  it("shifts nonexistent times forward across a spring-forward gap", () => {
    const result = resolveLocalIso("2026-03-29", 2 * 60 + 30, "Europe/Warsaw");

    expect(result.adjusted).toBe(true);
    expect(result.skippedMinutes).toBe(60);
    expect(result.iso).toBe("2026-03-29T03:30:00");
  });

  it("handles the spring-forward gap in another zone", () => {
    const result = resolveLocalIso("2026-03-08", 2 * 60 + 30, "America/New_York");

    expect(result.adjusted).toBe(true);
    expect(result.iso).toBe("2026-03-08T03:30:00");
  });

  it("keeps the first occurrence of an ambiguous fall-back time", () => {
    const result = resolveLocalIso("2026-10-25", 2 * 60 + 30, "Europe/Warsaw");

    expect(result.adjusted).toBe(false);
    expect(result.skippedMinutes).toBe(0);
    expect(result.iso).toBe("2026-10-25T02:30:00");
  });

  it("falls back to UTC when the zone is invalid", () => {
    const result = resolveLocalIso("2026-06-01", 8 * 60, "Not/AZone");

    expect(result.iso).toBe("2026-06-01T08:00:00");
  });

  it("returns an empty string for an invalid date", () => {
    expect(resolveLocalIso("not-a-date", 0, "UTC").iso).toBe("");
  });

  it("rolls minutes past midnight into the next day", () => {
    const result = resolveLocalIso("2026-06-01", 23 * 60 + 30, "UTC");

    expect(result.iso).toBe("2026-06-01T23:30:00");
  });
});

describe("offsetMinutes", () => {
  it("reports the summer offset for a DST zone", () => {
    expect(offsetMinutes("Europe/Warsaw", Date.UTC(2026, 5, 1, 12, 0, 0))).toBe(120);
  });

  it("reports the winter offset for a DST zone", () => {
    expect(offsetMinutes("Europe/Warsaw", Date.UTC(2026, 0, 15, 12, 0, 0))).toBe(60);
  });
});

describe("weekdayForDate", () => {
  it("computes the local weekday key", () => {
    expect(weekdayForDate("2026-06-01")).toBe("mon");
    expect(weekdayForDate("2026-03-29")).toBe("sun");
  });

  it("falls back to monday for invalid dates", () => {
    expect(weekdayForDate("garbage")).toBe("mon");
  });
});
