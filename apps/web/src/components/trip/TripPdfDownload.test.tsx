import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import TripPdfDownload from "./TripPdfDownload";
import { downloadTripPdf } from "../../api/pdf";
vi.mock("../../api/pdf", () => ({ downloadTripPdf: vi.fn() }));
beforeEach(() => vi.resetAllMocks()); afterEach(cleanup);
it("downloads an owner PDF and disables duplicate export while loading", async () => {
  let complete!: () => void; vi.mocked(downloadTripPdf).mockReturnValue(new Promise<void>(resolve => { complete = resolve; }));
  render(<TripPdfDownload target={{ tripId: "owner-trip" }} />); fireEvent.click(screen.getByText("Download PDF"));
  expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true); expect(screen.getByText("Creating PDF…")).toBeTruthy();
  expect(downloadTripPdf).toHaveBeenCalledWith({ tripId: "owner-trip" }, expect.any(AbortSignal)); complete();
  await waitFor(() => expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false));
});
it("uses the public token and provides retryable download errors", async () => {
  vi.mocked(downloadTripPdf).mockRejectedValue(new Error("Shared trip not found")); render(<TripPdfDownload target={{ shareToken: "token" }} />);
  fireEvent.click(screen.getByText("Download PDF")); await screen.findByText("Shared trip not found");
  expect(downloadTripPdf).toHaveBeenCalledWith({ shareToken: "token" }, expect.any(AbortSignal));
  vi.mocked(downloadTripPdf).mockResolvedValue(); fireEvent.click(screen.getByText("Download PDF"));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});
it("aborts a pending export when the page closes", () => {
  vi.mocked(downloadTripPdf).mockReturnValue(new Promise(() => {})); const view = render(<TripPdfDownload target={{ tripId: "trip" }} />);
  fireEvent.click(screen.getByText("Download PDF")); const signal = vi.mocked(downloadTripPdf).mock.calls[0][1]!; view.unmount(); expect(signal.aborted).toBe(true);
});
