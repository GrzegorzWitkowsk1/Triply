import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it } from "vitest";
import BottomNav from "./BottomNav";
afterEach(cleanup);
it("exposes four primary destinations and updates the active route", () => {
  render(<MemoryRouter initialEntries={["/home"]}><BottomNav /></MemoryRouter>);
  expect(screen.getAllByRole("link")).toHaveLength(4);
  expect(screen.getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBe("page");
  fireEvent.click(screen.getByRole("link", { name: "Saved" }));
  expect(screen.getByRole("link", { name: "Saved" }).getAttribute("aria-current")).toBe("page");
});
