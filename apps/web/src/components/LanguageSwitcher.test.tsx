import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import i18n from "../i18n";
import Header from "./layout/Header";
import LanguageSwitcher from "./LanguageSwitcher";
vi.mock("../auth/AuthProvider", () => ({ useAuth: () => ({ user: null, isGuest: true }) }));
vi.mock("../hooks/useNotifications", () => ({ useNotifications: () => ({ data: [] }) }));
beforeEach(async () => { await i18n.changeLanguage("en"); localStorage.clear(); });
afterEach(cleanup);
it("shows the current language and switches guest navigation immediately without changing routes or form state", async () => {
  function State() { return <><output>{useLocation().pathname}</output><input aria-label="Draft" defaultValue="Keep my edits" /></>; }
  render(<MemoryRouter initialEntries={["/trips/trip-id"]}><Header /><State /></MemoryRouter>);
  expect(screen.getByRole("button", { name: "Language: English" }).querySelector("img")?.getAttribute("src")).toBe("/flags/en.svg");
  expect(screen.getByRole("button", { name: "Language: English" }).textContent).toBe("EN");
  expect(screen.getByRole("button", { name: "Language: English" }).previousElementSibling).toBe(screen.getByRole("button", { name: "End guest session" }));
  fireEvent.click(screen.getByRole("button", { name: /^(Language|Język):/ })); fireEvent.click(screen.getByRole("menuitemradio", { name: "Polski" }));
  expect(await screen.findByRole("link", { name: "Moje podróże" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Język: Polski" }).querySelector("img")?.getAttribute("src")).toBe("/flags/pl.svg");
  expect(localStorage.getItem("triply.language")).toBe("pl"); expect(screen.getByText("/trips/trip-id")).toBeTruthy(); expect((screen.getByLabelText("Draft") as HTMLInputElement).value).toBe("Keep my edits");
  fireEvent.click(screen.getByRole("button", { name: /^(Language|Język):/ })); fireEvent.click(screen.getByRole("menuitemradio", { name: "English" }));
  expect(await screen.findByRole("link", { name: "My Trips" })).toBeTruthy(); expect(localStorage.getItem("triply.language")).toBe("en");
});
it("exposes a focusable control and both named options", () => {
  render(<LanguageSwitcher />); const control = screen.getByRole("button", { name: "Language: English" }); control.focus();
  fireEvent.click(control); expect(screen.getByRole("menuitemradio", { name: "English" })).toBeTruthy(); expect(screen.getByRole("menuitemradio", { name: "Polski" })).toBeTruthy();
});
