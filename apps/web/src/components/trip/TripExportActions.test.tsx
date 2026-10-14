import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render as renderBase, screen, waitFor } from "@testing-library/react";
import { ToastProvider } from "../ToastProvider";
import TripExportActions from "./TripExportActions";
import { downloadTripCalendar } from "../../api/calendar";
import { ApiError } from "../../api/client";
vi.mock("../../api/calendar", () => ({ downloadTripCalendar: vi.fn() }));
vi.mock("./TripSharing", () => ({ default: ({ open }: { open: boolean }) => open ? <div role="dialog">Sharing controls</div> : null }));
vi.mock("./TripPdfDownload", () => ({ default: ({ renderTrigger }: { renderTrigger?: (download: () => void, pending: boolean) => React.ReactNode }) => renderTrigger ? renderTrigger(vi.fn(), false) : <button>Download PDF</button> }));
beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); localStorage.setItem("triply.language", "en"); }); afterEach(cleanup);
const render = (component: React.ReactNode) => renderBase(<ToastProvider>{component}</ToastProvider>);
it("puts PDF, calendar and owner sharing in one accessible menu", async () => {
  render(<TripExportActions target={{ tripId: "trip" }} />); expect(screen.getByLabelText("More export options").getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(screen.getByLabelText("More export options")); expect(screen.getByRole("menuitem", { name: "Download PDF" })).toBeTruthy(); expect(screen.getByRole("menuitem", { name: "Export to Calendar" })).toBeTruthy();
  fireEvent.click(screen.getByRole("menuitem", { name: "Share" })); await screen.findByRole("dialog"); await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
});
it("shows two public buttons with no arrow or owner actions", async () => {
  let complete!: (stats: { exported: number; excluded: number; invalid: number; unscheduled: number }) => void;
  vi.mocked(downloadTripCalendar).mockReturnValue(new Promise(resolve => { complete = resolve; }));
  render(<TripExportActions target={{ shareToken: "token" }} />); expect(screen.getAllByRole("button")).toHaveLength(2); expect(screen.queryByLabelText("More export options")).toBeNull();
  fireEvent.click(screen.getByText("Export to Calendar")); expect((screen.getByRole("button", { name: "Preparing calendar..." }) as HTMLButtonElement).disabled).toBe(true);
  expect(downloadTripCalendar).toHaveBeenCalledWith({ shareToken: "token" }, expect.any(AbortSignal));
  complete({ exported: 4, excluded: 2, unscheduled: 2, invalid: 0 }); await screen.findByText(/4 events exported. 2 items excluded/); expect(screen.getByRole("alert").textContent).toContain("manual export");
});
it("uses the requested English calendar label with Polish errors and notices", async () => {
  localStorage.setItem("triply.language", "pl"); vi.mocked(downloadTripCalendar).mockRejectedValue(new ApiError("internal", 422, { code: "invalid-timezone" }));
  render(<TripExportActions target={{ shareToken: "token" }} />); fireEvent.click(screen.getByText("Export to Calendar")); await screen.findByText(/Brakuje strefy czasowej/); expect(screen.queryByText("internal")).toBeNull();
  vi.mocked(downloadTripCalendar).mockResolvedValue({ exported: 1, excluded: 0, invalid: 0, unscheduled: 0 }); fireEvent.click(screen.getByText("Export to Calendar")); await screen.findByText(/Wyeksportowane wydarzenia: 1/);
});
it("aborts downloads on unmount and reports revoked shares without leaking errors", async () => {
  vi.mocked(downloadTripCalendar).mockRejectedValue(new ApiError("private detail", 404)); const view = render(<TripExportActions target={{ shareToken: "token" }} />);
  fireEvent.click(screen.getByText("Export to Calendar")); await screen.findByText("This trip or sharing link is unavailable."); expect(screen.queryByText("private detail")).toBeNull();
  vi.mocked(downloadTripCalendar).mockReturnValue(new Promise(() => {})); fireEvent.click(screen.getByText("Export to Calendar")); const signal = vi.mocked(downloadTripCalendar).mock.calls.at(-1)![1]!; view.unmount(); expect(signal.aborted).toBe(true);
});
it("disables exports before a persisted itinerary is ready", () => {
  render(<TripExportActions target={{ tripId: "trip" }} ready={false} />); fireEvent.click(screen.getByLabelText("More export options"));
  expect(screen.getByRole("menuitem", { name: "Export to Calendar" }).getAttribute("aria-disabled")).toBe("true"); expect(screen.getByRole("menuitem", { name: "Share" }).getAttribute("aria-disabled")).toBeNull();
});
