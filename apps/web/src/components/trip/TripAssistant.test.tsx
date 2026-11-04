import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import i18n from "../../i18n";
import TripAssistant from "./TripAssistant";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({ send: vi.fn(), apply: vi.fn(), regenerate: vi.fn(), history: { data: { conversationId: "conversation", messages: [] as { id: string; role: "ai" | "user"; text: string }[] }, isLoading: false, error: null as Error | null } }));
vi.mock("../../hooks/useTripAssistant", () => ({ useTripAssistant: () => ({ history: mocks.history, send: { mutateAsync: async (input: unknown) => { const result = await mocks.send(input); mocks.history.data = { conversationId: "conversation", messages: result.messages }; return result; } }, apply: { mutateAsync: mocks.apply, isPending: false }, cancel: { isPending: false, mutate: vi.fn() } }) }));
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
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ message: "How many?", conversationId: "conversation", selectedDayId: "2", requestId: expect.any(String), timeZone: expect.any(String) }));
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
  it("keeps provider failures visible, preserves the draft, and retries with the failed user ID", async () => {
    mocks.send.mockResolvedValueOnce({ messages: [{ id: "u", role: "user", text: "Hours?", failed: true }, { id: "a", role: "ai", text: "Provider busy", failed: true }], response: { type: "error", message: "Provider busy", retryable: true } });
    open(); send("Hours?");
    await screen.findByText("Provider busy");
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("Hours?");
    expect(document.querySelector(".assistant-typing")).toBeNull();
    mocks.send.mockResolvedValueOnce({ messages: [{ id: "u", role: "user", text: "Hours?" }, { id: "a2", role: "ai", text: "Recovered hours" }], response: { type: "message", message: "Recovered hours" } });
    fireEvent.click(screen.getByRole("button", { name: "Retry message" }));
    await screen.findByText("Recovered hours");
    expect(mocks.send.mock.lastCall![0]).toMatchObject({ retryMessageId: "u", message: "Hours?" });
    expect(screen.getAllByText("Hours?")).toHaveLength(1);
  });
  it("isolates a new trip and ignores the old trip's late response", async () => {
    let resolve!: (value: unknown) => void;
    mocks.send.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const client = new QueryClient();
    const view = render(<QueryClientProvider client={client}><TripAssistant city="Madrid" tripId="first" selectedDayId="1" /></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Ask Triply" })); send("First trip");
    view.rerender(<QueryClientProvider client={client}><TripAssistant city="Paris" tripId="second" selectedDayId="1" /></QueryClientProvider>);
    expect(screen.queryByText("First trip")).toBeNull();
    await act(async () => resolve({ messages: [], response: { type: "message", message: "Late" } }));
    expect(screen.queryByText("Late")).toBeNull();
  });
  it("preserves Escape dismissal", () => {
    open(); fireEvent.keyDown(screen.getByRole("complementary"), { key: "Escape" });
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Ask Triply" }));
  });
  it("preserves a failed message draft and prevents simultaneous sends", async () => {
    let reject!: (error: Error) => void;
    mocks.send.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    open(); send("Keep this draft");
    expect((screen.getByRole("textbox", { name: "Message Triply" }) as HTMLInputElement).value).toBe("");
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Message Triply" }), { key: "Enter" });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error("offline")));
    expect(screen.getByRole("alert").textContent).toContain("Could not send");
    expect((screen.getByRole("textbox", { name: "Message Triply" }) as HTMLInputElement).value).toBe("Keep this draft");
    mocks.send.mockResolvedValue({ messages: [{ id: "ok", role: "ai", text: "Recovered" }], response: { type: "message" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByText("Recovered");
    expect((screen.getByRole("textbox", { name: "Message Triply" }) as HTMLInputElement).value).toBe("");
  });
  it.each(["Next question", "First message"])("does not discard a newer draft (%s) when an earlier message succeeds", async draft => {
    let resolve!: (value: unknown) => void;
    mocks.send.mockImplementation(() => new Promise(done => { resolve = done; }));
    open(); send("First message");
    fireEvent.change(screen.getByRole("textbox", { name: "Message Triply" }), { target: { value: draft } });
    await act(async () => resolve({ messages: [], response: { type: "message" } }));
    expect((screen.getByRole("textbox", { name: "Message Triply" }) as HTMLInputElement).value).toBe(draft);
  });
});
