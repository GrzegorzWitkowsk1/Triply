import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18n from "../../i18n";
import VisitControls from "./VisitControls";

afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

it("renders planned controls and sends the occurrence ID for visited and skipped", () => {
  const onChange = vi.fn();
  render(<VisitControls itemId="occurrence" name="Museum" status="planned" onChange={onChange} />);
  expect(screen.getByText("Planned")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Mark Museum as visited" }));
  fireEvent.click(screen.getByRole("button", { name: "Mark Museum as skipped" }));
  expect(onChange.mock.calls).toEqual([["occurrence", "visited"], ["occurrence", "skipped"]]);
  expect(screen.queryByText("Undo")).toBeNull();
});

it.each(["visited", "skipped"] as const)("renders %s and resets with an accessible native button", status => {
  const onChange = vi.fn();
  render(<VisitControls itemId="occurrence" name="Museum" status={status} onChange={onChange} />);
  expect(screen.getByText(status === "visited" ? "Visited" : "Skipped")).toBeTruthy();
  const undo = screen.getByRole("button", { name: "Reset Museum to planned" });
  undo.focus();
  expect(document.activeElement).toBe(undo);
  expect(undo.tagName).toBe("BUTTON");
  expect(undo.getAttribute("tabindex")).not.toBe("-1");
  fireEvent.click(undo);
  expect(onChange).toHaveBeenCalledWith("occurrence", "planned");
});

it("disables every mutation while saving", () => {
  const onChange = vi.fn();
  render(<VisitControls itemId="occurrence" name="Museum" status="planned" disabled onChange={onChange} />);
  screen.getAllByRole("button").forEach(button => {
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
  });
  expect(onChange).not.toHaveBeenCalled();
});

it("provides Polish labels", async () => {
  await i18n.changeLanguage("pl");
  render(<VisitControls itemId="occurrence" name="Muzeum" status="visited" onChange={() => {}} />);
  expect(screen.getByText("Odwiedzone")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Oznacz Muzeum jako pominięte" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Przywróć Muzeum do zaplanowanych" })).toBeTruthy();
});
