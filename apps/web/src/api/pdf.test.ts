import { afterEach, expect, it, vi } from "vitest";
import { downloadTripPdf } from "./pdf";
import i18n from "../i18n";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("captures Polish export locale before an in-flight UI language change", async () => {
  await i18n.changeLanguage("pl");
  let finish!: (value: ReturnType<typeof pdfResponse>) => void;
  const fetch = vi.fn(() => new Promise<ReturnType<typeof pdfResponse>>(resolve => { finish = resolve; })); vi.stubGlobal("fetch", fetch);
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:pdf" });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const pending = downloadTripPdf({ tripId: "trip" });
  await i18n.changeLanguage("en"); finish(pdfResponse()); await pending;
  expect(fetch).toHaveBeenCalledWith("/api/trips/trip/export/pdf?locale=pl", expect.any(Object));
});
function pdfResponse(filename = "triply-lodz-2030-10-27.pdf") {
  return { ok: true, status: 200, headers: new Headers({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"` }), blob: async () => new Blob(["%PDF-1.7 example"]) };
}
it("downloads safe filenames, uses owner credentials and revokes temporary blob URLs", async () => {
  const fetch = vi.fn().mockResolvedValue(pdfResponse()); vi.stubGlobal("fetch", fetch);
  const create = vi.fn().mockReturnValue("blob:pdf"), revoke = vi.fn();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: create }); Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { expect(this.download).toBe("triply-lodz-2030-10-27.pdf"); });
  await downloadTripPdf({ tripId: "trip" }); expect(click).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledWith("/api/trips/trip/export/pdf?locale=en", expect.objectContaining({ credentials: "include", cache: "no-store" }));
  await new Promise(resolve => setTimeout(resolve, 10)); expect(revoke).toHaveBeenCalledWith("blob:pdf"); expect(document.querySelector("a[download]")).toBeNull();
});
it("omits credentials and referrer for public export and rejects unsafe attachment filenames", async () => {
  const fetch = vi.fn().mockResolvedValue(pdfResponse("../../unsafe.pdf")); vi.stubGlobal("fetch", fetch);
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:pdf" }); Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { expect(this.download).toBe("triply-itinerary.pdf"); });
  await downloadTripPdf({ shareToken: "token" }); expect(fetch).toHaveBeenCalledWith("/api/public/trips/token/export/pdf?locale=en", expect.objectContaining({ credentials: "omit", referrerPolicy: "no-referrer" }));
});
it("handles revoked links, network errors and invalid PDF responses without downloading", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: "Shared trip not found" }) }); vi.stubGlobal("fetch", fetch);
  await expect(downloadTripPdf({ shareToken: "token" })).rejects.toThrow("Shared trip not found");
  fetch.mockRejectedValue(new Error("Network unavailable")); await expect(downloadTripPdf({ tripId: "trip" })).rejects.toThrow("Network unavailable");
  fetch.mockResolvedValue({ ok: true, headers: new Headers({ "Content-Type": "text/html" }) }); await expect(downloadTripPdf({ tripId: "trip" })).rejects.toThrow("did not return a PDF");
});
