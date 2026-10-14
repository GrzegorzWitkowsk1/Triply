import { afterEach, expect, it, vi } from "vitest";
import { downloadTripCalendar } from "./calendar";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function response(filename = "triply-barcelona-2030-06-02.ics") {
  return { ok: true, headers: new Headers({ "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`,
    "X-Triply-Calendar-Events": "2", "X-Triply-Calendar-Excluded": "1", "X-Triply-Calendar-Unscheduled": "1", "X-Triply-Calendar-Invalid": "0" }),
    blob: async () => new Blob(["BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n"]) };
}
function browserDownload() {
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:calendar") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
}
it("downloads owner .ics with safe filename, reports counts and cleans up blob URLs", async () => {
  browserDownload(); const fetch = vi.fn().mockResolvedValue(response()); vi.stubGlobal("fetch", fetch);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { expect(this.download).toBe("triply-barcelona-2030-06-02.ics"); });
  expect(await downloadTripCalendar({ tripId: "trip" })).toEqual({ exported: 2, excluded: 1, unscheduled: 1, invalid: 0 });
  expect(fetch).toHaveBeenCalledWith("/api/trips/trip/export/calendar", expect.objectContaining({ credentials: "include", cache: "no-store" }));
  await new Promise(resolve => setTimeout(resolve, 10)); expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:calendar"); expect(document.querySelector("a[download]")).toBeNull();
});
it("omits public cookies and referrers and rejects unsafe filenames", async () => {
  browserDownload(); const fetch = vi.fn().mockResolvedValue(response("../../unsafe.ics")); vi.stubGlobal("fetch", fetch);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { expect(this.download).toBe("triply-itinerary.ics"); });
  await downloadTripCalendar({ shareToken: "token" }); expect(fetch).toHaveBeenCalledWith("/api/public/trips/token/export/calendar", expect.objectContaining({ credentials: "omit", referrerPolicy: "no-referrer" }));
});
it("handles revoked access, invalid content and malformed statistics without downloading", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: "Shared trip not found" }) }); vi.stubGlobal("fetch", fetch);
  await expect(downloadTripCalendar({ shareToken: "token" })).rejects.toMatchObject({ status: 404 });
  fetch.mockResolvedValue({ ok: true, headers: new Headers({ "Content-Type": "text/html" }) }); await expect(downloadTripCalendar({ tripId: "trip" })).rejects.toMatchObject({ details: { code: "invalid-response" } });
  const invalid = response(); invalid.headers.set("X-Triply-Calendar-Events", "invalid"); fetch.mockResolvedValue(invalid); await expect(downloadTripCalendar({ tripId: "trip" })).rejects.toMatchObject({ status: 502 });
});
