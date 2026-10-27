import { describe, expect, it } from "vitest";
import { decimalToMinor, exportLocaleQuerySchema, exportText, formatCurrency, formatDate, formatDateRange, formatDistance, formatLocalTime, formatMoney, formatNumber, formatPercent } from "@triply/shared";

describe("shared locale-aware presentation", () => {
  it.each(["en", "pl"] as const)("formats %s without modifying values", locale => {
    expect(formatNumber(1234.5, { minimumFractionDigits: 2 }, locale)).toBe(new Intl.NumberFormat(locale === "pl" ? "pl-PL" : "en-US", { minimumFractionDigits: 2 }).format(1234.5));
    expect(formatCurrency(1234.5, "EUR", {}, locale)).toBe(new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(1234.5));
    expect(formatMoney(123450, "EUR", locale)).toBe(formatCurrency(1234.5, "EUR", {}, locale));
    expect(formatMoney(-1, "EUR", locale)).toBe(formatCurrency(-.01, "EUR", {}, locale));
    expect(formatDistance(1234, 2, locale)).toBe(locale === "pl" ? "1,23 km" : "1.23 km");
    expect(formatPercent(.255, { maximumFractionDigits: 1 }, locale)).toBe(locale === "pl" ? "25,5%" : "25.5%");
    expect(formatMoney(Number.MAX_SAFE_INTEGER, "EUR", locale)).toContain(locale === "pl" ? ",91" : ".91");
    expect(decimalToMinor("1234.50", "EUR")).toBe(123450);
    expect(formatDate("2026-10-27", { dateStyle: "long", timeZone: "America/Los_Angeles" }, locale)).toBe(locale === "pl" ? "27 października 2026" : "October 27, 2026");
    expect(formatDateRange("2026-12-31", "2027-01-02", { dateStyle: "long" }, locale)).toContain("2027");
    expect(formatLocalTime("2030-10-27T02:30:00+02:00", locale)).toBe("02:30");
    expect(formatLocalTime("2030-10-27T02:30:00+01:00", locale)).toBe("02:30");
    expect(formatLocalTime("2030-06-01T00:00:00", locale)).toBe("00:00");
  });
  it("rejects invalid dates and unsupported API locales, defaults only missing locale", () => {
    expect(exportLocaleQuerySchema.parse({}).locale).toBe("en");
    for (const locale of ["de", "pl-PL", "en;ignore", "", null, ["pl", "en"]]) expect(exportLocaleQuerySchema.safeParse({ locale }).success).toBe(false);
    expect(() => formatDate("2026-02-30")).toThrow(RangeError);
    expect(() => formatDateRange("2026-02-30", "2026-03-02")).toThrow(RangeError);
    expect(() => formatLocalTime("2030-06-01T25:00:00")).toThrow(RangeError);
  });
  it("keeps export interpolation data inert and uses matching catalogs", () => {
    expect(exportText("pl", "exports/pdf")("address", { address: "{{page}} <script> Łódź" })).toBe("Adres: {{page}} <script> Łódź");
  });
});
