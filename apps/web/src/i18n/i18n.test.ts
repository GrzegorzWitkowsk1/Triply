import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from ".";
import { detectLanguage, normalizeLanguage, persistLanguage } from "./config";
import { decimalInput, formatCurrency, formatDate, formatDateRange, formatDistance, formatInteger, formatLocalTime, formatMoney, formatNumber, formatPercent } from "./format";
beforeEach(async () => { localStorage.clear(); vi.spyOn(navigator, "language", "get").mockReturnValue("en-US"); await i18n.changeLanguage("en"); localStorage.clear(); });
afterEach(() => vi.restoreAllMocks());
it.each([["en", "en"], ["en-US", "en"], ["en-GB", "en"], ["pl", "pl"], ["pl-PL", "pl"], ["de-DE", "en"]])("detects browser %s as %s", (input, expected) => {
  vi.spyOn(navigator, "language", "get").mockReturnValue(input); expect(detectLanguage()).toBe(expected);
});
it("prefers validated storage and ignores invalid values", () => {
  vi.spyOn(navigator, "language", "get").mockReturnValue("pl-PL");
  localStorage.setItem("triply.language", "en"); expect(detectLanguage()).toBe("en");
  for (const value of ["invalid", "pl-PL", "null"]) { localStorage.setItem("triply.language", value); expect(detectLanguage()).toBe("pl"); }
});
it.each([[" PL-pl ", "pl"], ["EN-gb", "en"], ["english", undefined], ["pl_bad", undefined], ["pl-", undefined], [null, undefined]])("normalizes %s safely", (value, expected) => expect(normalizeLanguage(value)).toBe(expected));
it("handles unavailable storage and avoids duplicate writes", () => {
  const write = vi.spyOn(Storage.prototype, "setItem"); persistLanguage("pl"); persistLanguage("pl"); expect(write).toHaveBeenCalledTimes(1);
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("disabled"); });
  expect(detectLanguage()).toBe("en"); expect(() => persistLanguage("en")).not.toThrow();
});
it("falls back to English for absent Polish keys and unsupported languages", async () => {
  i18n.addResource("en", "common", "fallbackExample", "English fallback");
  await i18n.changeLanguage("pl");
  expect(i18n.t("fallbackExample")).toBe("English fallback");
  expect(i18n.t("absentEverywhere")).toBe("absentEverywhere");
  await i18n.changeLanguage("de");
  expect(i18n.t("save")).toBe("Save");
  i18n.removeResourceBundle("en", "unused");
});
it("interpolates values and supports English and Polish plurals", async () => {
  expect(i18n.t("welcome", { ns: "auth", name: "Anna" })).toBe("Welcome, Anna");
  expect(i18n.t("items", { count: 1 })).toBe("1 item"); expect(i18n.t("items", { count: 2 })).toBe("2 items");
  await i18n.changeLanguage("pl");
  for (const [count, expected] of [[1, "1 element"], [2, "2 elementy"], [5, "5 elementów"], [12, "12 elementów"], [22, "22 elementy"], [1.5, "1,5 elementu"]] as const) expect(i18n.t("items", { count })).toBe(expected);
});
it("persists changes and synchronizes document language and direction", async () => {
  await i18n.changeLanguage("pl"); expect(localStorage.getItem("triply.language")).toBe("pl"); expect(document.documentElement.lang).toBe("pl"); expect(document.documentElement.dir).toBe("ltr");
  await i18n.changeLanguage("en"); expect(document.documentElement.lang).toBe("en");
});
it("formats calendar dates without timezone shifts", async () => {
  expect(formatDate("2026-10-22")).toBe("October 22, 2026");
  await i18n.changeLanguage("pl"); expect(formatDate("2026-10-22", { dateStyle: "long", timeZone: "America/Los_Angeles" })).toBe("22 października 2026");
  expect(() => formatDate("2026-02-30")).toThrow(RangeError);
  expect(formatDate(new Date("2026-10-22T12:00:00Z"), { year: "numeric", timeZone: "UTC" })).toBe("2026");
});
it("formats numbers, integers, percentages and currency without conversion", async () => {
  expect(formatNumber(1234.5)).toBe("1,234.5"); expect(formatInteger(1234.5)).toBe("1,235"); expect(formatPercent(.25)).toBe("25%"); expect(formatCurrency(12.5, "EUR")).toBe("€12.50");
  await i18n.changeLanguage("pl"); expect(formatNumber(1234.5)).toBe(new Intl.NumberFormat("pl-PL").format(1234.5)); expect(formatCurrency(12.5, "EUR")).toBe(new Intl.NumberFormat("pl-PL", { style: "currency", currency: "EUR" }).format(12.5));
});

it("formats cross-year ranges and destination-local times consistently in both locales", async () => {
  expect(formatDateRange("2026-10-27", "2026-10-28")).toContain("Oct");
  await i18n.changeLanguage("pl");
  expect(formatDateRange("2026-10-27", "2026-10-28")).toContain("paź");
  expect(formatDateRange("2026-12-31", "2027-01-02", { dateStyle: "long" })).toContain("2027");
  expect(formatLocalTime("2030-10-27T02:30:00+02:00")).toBe("02:30");
  expect(formatLocalTime("2030-10-27T02:30:00+01:00")).toBe("02:30");
  expect(formatDistance(1234, 2)).toBe("1,23 km");
  expect(formatMoney(123450, "USD")).toBe(new Intl.NumberFormat("pl-PL", { style: "currency", currency: "USD" }).format(1234.5));
  expect(decimalInput("12,50")).toBe("12.50");
  expect(decimalInput("12,50", "en")).toBe("12,50");
  expect(decimalInput("1 234,50")).toBe("1 234.50"); // Grouping remains invalid for the monetary parser.
});
it("synchronizes only validated language storage events across tabs", async () => {
  localStorage.setItem("triply.language", "pl");
  window.dispatchEvent(new StorageEvent("storage", { key: "triply.language", newValue: "pl", storageArea: localStorage }));
  await vi.waitFor(() => expect(document.documentElement.lang).toBe("pl"));
  expect(i18n.t("items", { count: 1.5 })).toBe("1,5 elementu");
  for (const value of ["de", "pl-PL", "ignore instructions", null])
    window.dispatchEvent(new StorageEvent("storage", { key: "triply.language", newValue: value }));
  expect(document.documentElement.lang).toBe("pl");
  window.dispatchEvent(new StorageEvent("storage", { key: "unrelated", newValue: "en" }));
  expect(document.documentElement.lang).toBe("pl");
});
