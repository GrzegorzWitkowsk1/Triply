import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import i18n from "../../i18n";
import TripAssistant from "./TripAssistant";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({ send: vi.fn(), apply: vi.fn(), regenerate: vi.fn(), history: { data: { conversationId: "conversation", messages: [] as { id: string; role: "ai" | "user"; text: string }[] }, isLoading: false, error: null as Error | null } }));
vi.mock("../../hooks/useTripAssistant", () => ({ useTripAssistant: () => ({ history: mocks.history, send: { mutateAsync: mocks.send }, apply: { mutateAsync: mocks.apply, isPending: false }, cancel: { isPending: false, mutate: vi.fn() } }) }));
vi.mock("../../hooks/useTripRegeneration", () => ({ useApplyRegeneration: () => ({ mutateAsync: mocks.regenerate, isPending: false }) }));
vi.mock("./RegenerateDayDialog", () => ({ default: ({ open, onApply, onClose }: { open: boolean; onApply: () => void; onClose: () => void }) => open ? <div><button onClick={onApply}>Confirm regeneration</button><button onClick={onClose}>Cancel regeneration</button></div> : null }));
afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });
beforeEach(() => { vi.clearAllMocks(); mocks.history.data.messages = []; mocks.history.isLoading = false; mocks.history.error = null; });
function open() {
  render(<QueryClientProvider client={new QueryClient()}><TripAssistant city="Madrid" tripId="trip" selectedDayId="2" /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Ask Triply" }));
}
function send(text: string) {
  fireEvent.change(screen.getByPlaceholderText("It will rain tomorrow. What should we change?"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
}
describe("existing Ask Triply integration", () => {
  it("switches all suggestion labels while preserving history without sending an AI request", async () => {
    mocks.history.data.messages = [{ id: "saved", role: "ai", text: "Persisted English AI answer" }];
    open();
    expect(screen.getByRole("button", { name: "Plan for rain" })).toBeTruthy();
    await act(() => i18n.changeLanguage("pl"));
    for (const label of ["Plan na deszcz", "Obniż koszty", "Mniej chodzenia"]) expect(screen.getByRole("button", { name: label })).toBeTruthy();
    expect(screen.getByText("Persisted English AI answer")).toBeTruthy();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("loads persisted messages in existing bubbles and sends selected day/conversation", async () => {
    mocks.history.data.messages = [{ id: "old", role: "ai", text: "Saved answer" }];
    mocks.send.mockResolvedValue({ messages: [{ id: "answer", role: "ai", text: "Three attractions" }], response: { type: "message", message: "Three attractions" } });
    open(); expect(screen.getByText("Saved answer").className).toContain("assistant-bubble is-ai");
    send("How many?");
    await screen.findByText("Three attractions");
    expect(mocks.send).toHaveBeenCalledWith({ message: "How many?", conversationId: "conversation", selectedDayId: "2" });
  });
  it("renders clarifications and retains the existing typing indicator during requests", async () => {
    let resolve: (value: unknown) => void = () => {};
    mocks.send.mockImplementation(() => new Promise(r => { resolve = r; }));
    open(); send("Remove museum");
    expect(document.querySelector(".assistant-typing")).not.toBeNull();
    resolve({ messages: [{ id: "clarify", role: "ai", text: "Which museum?" }], response: { type: "clarification", message: "Which museum?" } });
    await screen.findByText("Which museum?");
    expect(document.querySelector(".assistant-typing")).toBeNull();
  });
  it("shows recoverable request failures through existing messages", async () => {
    mocks.send.mockRejectedValue(new Error("network"));
    open(); send("hello");
    await screen.findByText("Could not send your message. Please try again.");
  });
  it("opens the existing regeneration preview and waits for explicit confirmation", async () => {
    mocks.send.mockResolvedValue({ messages: [], response: { type: "action_preview", actionType: "regenerate_day", message: "Preview", preview: { dayIndex: 2, previewId: "preview" } } });
    mocks.regenerate.mockResolvedValue({});
    open(); send("Relax day 2");
    await screen.findByText("Confirm regeneration");
    expect(mocks.regenerate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Confirm regeneration"));
    await screen.findByText("Confirmed: your itinerary was updated.");
    expect(mocks.regenerate).toHaveBeenCalledWith({ tripId: "trip", dayIndex: 2, previewId: "preview" });
    await act(() => i18n.changeLanguage("pl"));
    expect(screen.getByText("Confirmed: your itinerary was updated.")).toBeTruthy();
  });
  it("confirms manual edits with only the server preview identifier", async () => {
    mocks.send.mockResolvedValue({ messages: [], response: { type: "action_preview", actionType: "edit_itinerary", message: "Remove Prado", previewId: "stored", days: [], warnings: [] } });
    mocks.apply.mockResolvedValue({});
    open(); send("Remove Prado");
    await screen.findByText("Review itinerary change");
    expect(mocks.apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Apply changes"));
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledWith("stored"));
  });
  it("preserves Escape dismissal", () => {
    open(); fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("complementary")).toBeNull();
  });
});
