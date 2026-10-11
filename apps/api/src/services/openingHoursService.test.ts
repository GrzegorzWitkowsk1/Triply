import { describe, expect, it } from "vitest";
import { evaluateOpeningHours, resolvePoiTimeZone } from "./openingHoursService.js";

function check(raw: string | null, date = "2026-10-13", startMinutes = 600, durationMinutes = 60, timeZone: string | null = "Europe/Warsaw") {
  return evaluateOpeningHours({ metadata: { raw, source: "osm", checkedAt: null }, date, startMinutes, durationMinutes, timeZone });
}
describe("OSM opening-hours availability", () => {
  it("evaluates weekly hours and closed weekdays", () => {
    expect(check("Tu-Su 10:00-18:00; Mo off").status).toBe("open");
    expect(check("Tu-Su 10:00-18:00; Mo off", "2026-10-12").status).toBe("closed");
  });
  it("requires the whole visit to fit and derives a later split interval", () => {
    expect(check("10:00-17:00", undefined, 990, 90).status).toBe("closed");
    const result = check("10:00-12:00,14:00-18:00", undefined, 690, 90);
    expect(result.status).toBe("closed");
    expect(result.nextAvailableStart).toBe("2026-10-13T14:00:00");
    expect(result.intervals).toHaveLength(2);
  });
  it("handles previous-day overnight periods", () => {
    expect(check("Mo 22:00-02:00", "2026-10-12", 1380, 120).status).toBe("open");
    expect(check("Mo 22:00-02:00", "2026-10-13", 30, 60).status).toBe("open");
    expect(check("Mo 22:00-02:00", "2026-10-13", 90, 60).status).toBe("closed");
  });
  it("evaluates seasonal rules", () => {
    expect(check("Apr-Sep 10:00-18:00; Oct-Mar off").status).toBe("closed");
    expect(check("Apr-Sep 10:00-18:00; Oct-Mar off", "2026-07-14").status).toBe("open");
  });
  it("keeps missing, invalid and uncertain expressions unknown", () => {
    for (const raw of [null, "not valid opening hours", "unknown", "10:00+"]) {
      expect(check(raw, undefined, 720).status).toBe("unknown");
    }
  });
  it("does not assume holiday context or a missing zone", () => {
    expect(check("Mo-Fr 09:00-17:00; PH off").status).toBe("unknown");
    expect(check("24/7", undefined, 600, 60, null).status).toBe("unknown");
  });
  it("resolves coordinates and evaluates independently of the server zone", () => {
    expect(resolvePoiTimeZone({ lat: 40.71, lng: -74 })).toBe("America/New_York");
    for (const zone of ["America/New_York", "Asia/Tokyo", "Pacific/Auckland"]) {
      expect(check("Tu 10:00-11:00", undefined, 600, 60, zone).status).toBe("open");
    }
  });
  it("uses elapsed visit duration over spring DST and rejects ambiguous starts", () => {
    expect(check("24/7", "2026-04-05", 105, 60, "Australia/Lord_Howe").status).toBe("unknown");
    expect(check("Su 01:00-04:00", "2026-03-29", 90, 150).status).toBe("closed");
    expect(check("24/7", "2026-03-29", 150).status).toBe("unknown");
    expect(check("24/7", "2026-10-25", 150).status).toBe("unknown");
    expect(check("Su 10:00-18:00", "2026-03-29").status).toBe("open");
  });
});
