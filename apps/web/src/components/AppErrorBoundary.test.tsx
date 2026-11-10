import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppErrorBoundary } from "./AppErrorBoundary";
import i18n from "../i18n";

afterEach(async () => { cleanup(); vi.restoreAllMocks(); await i18n.changeLanguage("en"); });
it.each(["en", "pl"])("shows a localized fallback and recovers only on explicit retry (%s)", async language => {
  await i18n.changeLanguage(language);
  vi.spyOn(console, "error").mockImplementation(() => {});
  let broken = true;
  const child = vi.fn(() => { if (broken) throw new Error("sensitive stack details"); return <p>Recovered</p>; });
  render(<AppErrorBoundary>{childElement()}</AppErrorBoundary>);
  function childElement() { const Child = child; return <Child />; }
  expect(screen.getByRole("alert").textContent).toContain(i18n.t("renderRecovery", { ns: "errors" }));
  expect(screen.queryByText(/sensitive/)).toBeNull();
  expect(screen.getByRole("link").getAttribute("href")).toBe("/home");
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByRole("alert")).toBeTruthy();
  const attempts = child.mock.calls.length;
  await Promise.resolve();
  expect(child).toHaveBeenCalledTimes(attempts);
  broken = false;
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByText("Recovered")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});
