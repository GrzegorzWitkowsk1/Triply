import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EQUIPMENT_CATEGORIES, EXPENSE_CATEGORIES, INTEREST_OPTIONS, PACE_VALUES } from "@triply/shared";
import i18n from ".";
import { errorKey, errorMessage } from "./errors";
import { breakLabel, categoryLabel, expenseCategoryLabel, interestLabel, paceLabel } from "./labels";
import { COLLECTIONS } from "../config/explore";
import { NOTIFICATIONS } from "../config/notifications";
import { createRequirementsSchema, TRIP_REQUIREMENTS_DEFAULTS } from "../schemas/tripAnalysis";
import PreferenceFields from "../components/trip/PreferenceFields";
import { ToastProvider, useToast } from "../components/ToastProvider";
afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });
it("localizes exact scheduler break labels without replacing original place or AI titles", async () => {
  await i18n.changeLanguage("pl");
  expect(breakLabel("Lunch break")).toBe("Przerwa na obiad");
  expect(breakLabel("Coffee break")).toBe("Przerwa na kawę");
  expect(breakLabel("Dinner break")).toBe("Przerwa na kolację");
  expect(breakLabel("Lunch break at Anna's restaurant")).toBe("Lunch break at Anna's restaurant");
});

it.each(["en", "pl"] as const)("resolves every supported enum, Packing category and curated collection in %s", async lng => {
  await i18n.changeLanguage(lng);
  for (const value of INTEREST_OPTIONS) expect(interestLabel(value.id)).not.toContain("interest_");
  for (const value of PACE_VALUES) expect(paceLabel(value)).not.toContain("pace_");
  for (const value of EXPENSE_CATEGORIES) expect(expenseCategoryLabel(value)).not.toContain("category_");
  for (const value of EQUIPMENT_CATEGORIES) expect(i18n.exists(value === "health" ? "healthSafety" : value, { lng, ns: "packing" })).toBe(true);
  for (const collection of COLLECTIONS) {
    expect(collection.title).not.toMatch(/Title$/); expect(collection.description).not.toMatch(/Description$/);
  }
  expect(categoryLabel("unknown-provider-category")).toBe(lng === "pl" ? "Atrakcja" : "Attraction");
});
it("uses pace labels independently of walking labels and retains selected values", async () => {
  await i18n.changeLanguage("en");
  const change = vi.fn();
  render(<PreferenceFields disabled={false} tags={[]} onToggleTag={change} pace={1} walking={2} onPaceChange={change} onWalkingChange={change} />);
  expect(screen.getByRole("button", { name: "Balanced" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: "High" }).getAttribute("aria-pressed")).toBe("true");
  await act(() => i18n.changeLanguage("pl"));
  expect(screen.getByRole("button", { name: "Zrównoważone" }).getAttribute("aria-pressed")).toBe("true");
  expect(change).not.toHaveBeenCalled();
});
it.each([
  [0, "0 dni", "Wybrano 0 sugestii"], [1, "1 dzień", "Wybrano 1 sugestię"],
  [2, "2 dni", "Wybrano 2 sugestie"], [5, "5 dni", "Wybrano 5 sugestii"],
  [12, "12 dni", "Wybrano 12 sugestii"], [22, "22 dni", "Wybrano 22 sugestie"],
])("inflects Polish day and Packing counts: %s", async (count, days, selected) => {
  await i18n.changeLanguage("pl");
  expect(i18n.t("days", { ns: "common", count })).toBe(days);
  expect(i18n.t("selectedCount", { ns: "packing/suggestions", count })).toBe(selected);
  expect(i18n.t("bulkPacked", { ns: "packing", count })).toBe(`Spakowano ${count} ${count === 1 ? "rzecz" : "rzeczy"}.`);
});
it("localizes schema errors, including country length, without rebuilding the form", async () => {
  const result = createRequirementsSchema(["destination"]).safeParse({ ...TRIP_REQUIREMENTS_DEFAULTS, country: "x".repeat(121) });
  expect(result.success).toBe(false);
  if (result.success) return;
  const keys = result.error.issues.map(issue => issue.message);
  expect(keys).toContain("tripCreator/validation:fieldTooLong");
  for (const lng of ["en", "pl"]) {
    await i18n.changeLanguage(lng);
    for (const key of keys) { expect(i18n.exists(key)).toBe(true); expect(i18n.t(key)).not.toBe(key); }
  }
});
it.each([
  [1, "1 cena wstępu jest niepotwierdzona."],
  [2, "2 ceny wstępu są niepotwierdzone."],
  [5, "5 cen wstępu jest niepotwierdzonych."],
  [12, "12 cen wstępu jest niepotwierdzonych."],
  [22, "22 ceny wstępu są niepotwierdzone."],
])("inflects Polish expense admission counts: %s", async (count, expected) => {
  await i18n.changeLanguage("pl");
  expect(i18n.t("unconfirmedPrices", { ns: "expenses", count })).toBe(expected);
});
it.each([
  [{ status: 403 }, "forbidden"], [{ status: 409 }, "conflict"], [{ status: 422 }, "validation"],
  [{ name: "TimeoutError" }, "timeout"], [{ code: "GUEST_PACKING_LIMIT_REACHED" }, "guestPackingLimit"],
  [{ code: "GUEST_AI_LIMIT_REACHED" }, "guestAiLimit"], [{ code: "GUEST_TRIP_LIMIT_REACHED" }, "guestTripLimit"],
  [new Error("Private English backend diagnostic"), "unexpected"],
])("localizes stable error codes with a safe unknown fallback: %j", async (error, key) => {
  expect(errorKey(error)).toBe(`errors:${key}`);
  for (const lng of ["en", "pl"]) {
    await i18n.changeLanguage(lng);
    expect(errorMessage(error)).toBe(i18n.t(key, { ns: "errors" }));
    expect(errorMessage(error)).not.toContain("Private English");
  }
});
it("updates visible toasts and notification copy when the language changes", async () => {
  await i18n.changeLanguage("en");
  function Notice() { const toast = useToast(); return <button onClick={() => toast(() => i18n.t("profileSaved", { ns: "auth/profile" }))}>Show toast</button>; }
  render(<ToastProvider><Notice /></ToastProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Show toast" }));
  expect(screen.getByRole("alert").textContent).toBe("Profile saved.");
  const original = NOTIFICATIONS.at(-1)!.message;
  await act(() => i18n.changeLanguage("pl"));
  expect(screen.getByRole("alert").textContent).toBe("Profil został zapisany.");
  expect(NOTIFICATIONS.at(-1)!.message).not.toBe(original);
});
