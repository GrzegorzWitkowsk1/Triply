import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { TripAnalysisResult } from "@triply/shared";
import HomePage from "./HomePage";
import i18n from "../i18n";
import { ApiError } from "../api/client";
const mocks = vi.hoisted(() => ({ guest: false, analyze: vi.fn() }));
vi.mock("../auth/AuthProvider", () => ({ useAuth: () => ({ user: mocks.guest ? null : { id: "user" }, status: mocks.guest ? "guest" : "authenticated" }) }));
vi.mock("../hooks/useGuestUsage", () => ({ useGuestUsage: () => ({ isGuest: mocks.guest, data: { tripCount: 0, tripLimit: 6, aiGenerationsRemaining: 2 } }) }));
vi.mock("../hooks/useTrips", () => ({ useTrips: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock("../hooks/useTripAnalysis", () => ({ useAnalyzeTrip: () => ({ mutate: mocks.analyze, isPending: false, reset: vi.fn() }), useUpdateTripRequirements: () => ({ mutate: vi.fn(), isPending: false }) }));
vi.mock("../hooks/useTripGeneration", () => ({ useConfirmTrip: () => ({ mutate: vi.fn(), isPending: false }) }));
let client: QueryClient;
const file = (name = "places.txt", text = "Colosseum") => new File([text], name, { type: "text/plain", lastModified: 1 });
const result: TripAnalysisResult = { draftId: "draft", missingFields: [], requirementsComplete: true,
  analysis: { destination: "Rome", country: "Italy", durationDays: 3, startDate: null, endDate: null, travelers: 2, budget: { amount: 500, currency: "EUR", type: "total" }, interests: ["food"], pace: "balanced", maxWalkingDistanceKm: 5, notes: null } };
type Callbacks = { onSuccess: (value: TripAnalysisResult) => void; onError: (error: Error) => void; onSettled: () => void };
function mount() { client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); return render(<QueryClientProvider client={client}><MemoryRouter><HomePage /></MemoryRouter></QueryClientProvider>); }
function pick(view: ReturnType<typeof mount>, files: File[]) { const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')!; fireEvent.change(input, { target: { files } }); return input; }
function start() { fireEvent.change(screen.getByRole("textbox"), { target: { value: "Three days in Rome" } }); fireEvent.click(screen.getByRole("button", { name: "Plan my trip" })); }
beforeEach(async () => { vi.clearAllMocks(); mocks.guest = false; await i18n.changeLanguage("en"); });
afterEach(() => { cleanup(); client?.clear(); });
describe("homepage attachments", () => {
  it("opens the picker for an account and displays filename, size, privacy and removal", () => {
    const view = mount(), input = view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const click = vi.spyOn(input, "click"); fireEvent.click(screen.getByRole("button", { name: "Attachments" })); expect(click).toHaveBeenCalledOnce();
    pick(view, [file()]); expect(screen.getByText("places.txt")).toBeInTheDocument(); expect(screen.getByText(/KB/)).toBeInTheDocument(); expect(screen.getByText(/external AI provider/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove places.txt" })); expect(screen.queryByText("places.txt")).not.toBeInTheDocument();
  });
  it("preserves the prompt, blocks invalid files, and permits retry only after removal", () => {
    const view = mount(); fireEvent.change(screen.getByRole("textbox"), { target: { value: "Rome" } }); pick(view, [file("image.png")]);
    expect(screen.getByRole("textbox")).toHaveValue("Rome"); expect(screen.getByRole("button", { name: "Plan my trip" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Remove image.png" })); expect(screen.getByRole("button", { name: "Plan my trip" })).toBeEnabled();
  });
  it("prevents guests opening attachment selection but preserves prompt-only planning", () => {
    mocks.guest = true; const view = mount(); const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')!; const click = vi.spyOn(input, "click");
    fireEvent.click(screen.getByRole("button", { name: "Attachments" })); expect(click).not.toHaveBeenCalled(); expect(screen.getAllByText(/Create an account or sign in/).length).toBeGreaterThan(0);
    start(); expect(mocks.analyze.mock.calls[0][0]).not.toHaveProperty("files");
  });
  it("submits selected files, displays genuine processing, and prevents repeat submissions", () => {
    const view = mount(); pick(view, [file()]); start(); expect(mocks.analyze.mock.calls[0][0].files).toHaveLength(1);
    expect(mocks.analyze.mock.calls[0][0]).not.toHaveProperty("pace");
    expect(mocks.analyze.mock.calls[0][0]).not.toHaveProperty("maxWalkingDistanceKm");
    expect(screen.getByText(/Reading attachments/)).toBeInTheDocument(); expect(mocks.analyze).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Plan my trip" })).not.toBeInTheDocument();
  });
  it("cancels an upload and suppresses its late successful response", () => {
    const view = mount(); pick(view, [file()]); start(); const input = mocks.analyze.mock.calls[0][0]; const callbacks = mocks.analyze.mock.calls[0][1] as Callbacks;
    fireEvent.click(screen.getByRole("button", { name: "Cancel" })); expect(input.signal.aborted).toBe(true);
    act(() => { callbacks.onSuccess(result); callbacks.onSettled(); }); expect(screen.queryByRole("button", { name: "Generate my trip" })).not.toBeInTheDocument(); expect(screen.getByRole("textbox")).toHaveValue("Three days in Rome");
  });
  it("aborts attachment work when navigation unmounts the page", () => {
    const view = mount(); pick(view, [file()]); start(); const signal = mocks.analyze.mock.calls[0][0].signal as AbortSignal; view.unmount(); expect(signal.aborted).toBe(true);
  });
  it("associates unreadable file errors and requires removal while preserving valid files", () => {
    const view = mount(); pick(view, [file("good.txt"), file("bad.txt", "bad")]); start(); const callbacks = mocks.analyze.mock.calls[0][1] as Callbacks;
    act(() => { callbacks.onError(new ApiError("failed", 422, { code: "ATTACHMENT_FAILED", failures: [{ index: 1, code: "ATTACHMENT_SCANNED_PDF" }] })); callbacks.onSettled(); });
    expect(screen.getByText("good.txt")).toBeInTheDocument(); expect(screen.getByRole("button", { name: "Plan my trip" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Remove bad.txt" })); expect(screen.getByRole("button", { name: "Plan my trip" })).toBeEnabled(); expect(screen.getByRole("textbox")).toHaveValue("Three days in Rome");
  });
  it("localizes errors and privacy copy in Polish", async () => {
    await i18n.changeLanguage("pl"); const view = mount(); pick(view, [file("image.png")]);
    expect(screen.getByText(/Obsługujemy tylko/)).toBeInTheDocument(); expect(screen.getByText(/zewnętrznego dostawcy AI/)).toBeInTheDocument();
  });
});
