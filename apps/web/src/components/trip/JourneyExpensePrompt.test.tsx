import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import JourneyExpensePrompt from "./JourneyExpensePrompt";
import i18n from "../../i18n";
afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

it("keeps navigation nonmodal and dismisses with Escape without acting on the checkbox", () => {
  const action = vi.fn(); const dismiss = vi.fn();
  render(<><button>Other action</button><JourneyExpensePrompt name="Museum" onAction={action} onDismiss={dismiss} /></>);
  expect(screen.queryByRole("dialog")).toBeNull();
  const button = screen.getByRole("button", { name: "Other action" }); button.focus(); expect(document.activeElement).toBe(button);
  fireEvent.click(screen.getByRole("checkbox"));
  expect(action).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
  expect(dismiss).toHaveBeenCalled(); expect(action).not.toHaveBeenCalled();
});
it("renders Polish prompt, actions and accessible checkbox", async () => {
  await i18n.changeLanguage("pl"); const action = vi.fn();
  render(<JourneyExpensePrompt name="Muzeum" onAction={action} onDismiss={() => {}} />);
  expect(screen.getByRole("region", { name: "Dodać wydatek do tej wizyty?" })).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox", { name: "Nie pytaj ponownie. Będę dodawać wydatki ręcznie." }));
  fireEvent.click(screen.getByRole("button", { name: "Nie teraz" })); expect(action).toHaveBeenCalledWith(false, true);
});
