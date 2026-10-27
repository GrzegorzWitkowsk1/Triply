import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import i18n, { resources } from ".";
import { namespaces } from "./namespaces";
import TripBudgetCard from "../components/trip/TripBudgetCard";
import { calendarMessages } from "../config/calendarExport";

afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

it("bundles precisely the registered feature namespaces in both languages", () => {
  expect(Object.keys(resources.en).sort()).toEqual([...namespaces].sort());
  expect(Object.keys(resources.pl).sort()).toEqual([...namespaces].sort());
});
it("resolves feature-specific UI reactively without confusing it with common actions", async () => {
  await i18n.changeLanguage("en");
  render(<TripBudgetCard whole={100} />);
  expect(screen.getByRole("heading", { name: "Trip budget & expenses" })).toBeTruthy();
  await i18n.changeLanguage("pl");
  expect(await screen.findByRole("heading", { name: "Budżet i wydatki podróży" })).toBeTruthy();
  expect(i18n.t("save", { ns: "common" })).toBe("Zapisz");
  expect(i18n.t("saving", { ns: "itinerary" })).toBe("Zapisywanie planu…");
  expect(i18n.t("saving", { ns: "common" })).toBe("Zapisywanie...");
});
it.each(["en", "pl"] as const)("renders the entire calendar notice in %s without unresolved tokens", async language => {
  await i18n.changeLanguage(language);
  for (const exported of [1, 2, 5, 12, 22]) {
    const result = calendarMessages().result(exported, 2);
    expect(result).toContain(String(exported));
    expect(result).toContain(language === "en" ? "2 items excluded" : "Pominięte pozycje: 2");
    expect(result).toContain(language === "en" ? "manual export" : "ręczny eksport");
    expect(result).not.toMatch(/\{\{|\$t\(/);
  }
});
