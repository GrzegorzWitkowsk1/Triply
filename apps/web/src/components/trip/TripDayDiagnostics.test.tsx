import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import i18n from "../../i18n";
import TripDayDiagnostics from "./TripDayDiagnostics";
afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });
it("renders localized diagnostic severity without exposing internal codes", async () => {
  render(<TripDayDiagnostics issues={[{ code: "ACTIVITY_OVERLAP", severity: "error", dimension: "schedule", message: "Internal diagnostics" }]} hasWarnings />);
  expect(screen.getByRole("alert").textContent).toContain("Activities overlap");
  expect(screen.queryByText("Internal diagnostics")).toBeNull();
  expect(screen.queryByText("ACTIVITY_OVERLAP")).toBeNull();
  await act(() => i18n.changeLanguage("pl"));
  expect(screen.getByRole("alert").textContent).not.toContain("Activities overlap");
});
