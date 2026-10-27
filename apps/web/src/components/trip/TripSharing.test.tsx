import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TripSharing from "./TripSharing";
import {
  createShareLink,
  disableSharing,
  getSharingStatus,
} from "../../api/sharing";
vi.mock("../../api/sharing", () => ({
  createShareLink: vi.fn(),
  disableSharing: vi.fn(),
  getSharingStatus: vi.fn(),
}));
const disabled = { enabled: false, createdAt: null, updatedAt: null };
const enabled = {
  enabled: true,
  createdAt: "2030-01-01",
  updatedAt: "2030-01-01",
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSharingStatus).mockResolvedValue(disabled);
  vi.mocked(createShareLink).mockResolvedValue({
    ...enabled,
    token: "a".repeat(43),
  });
  vi.mocked(disableSharing).mockResolvedValue(disabled);
});
afterEach(cleanup);
function mount() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <TripSharing tripId="trip-id" />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByText("Share"));
}
it("shows disabled state, creates and copies a once-only link", async () => {
  const copy = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: copy },
  });
  mount();
  await screen.findByText("Sharing disabled");
  fireEvent.click(screen.getByText("Enable sharing"));
  await screen.findByLabelText("Share link");
  fireEvent.click(screen.getByText("Copy link"));
  await screen.findByText("Link copied");
  expect(copy).toHaveBeenCalledWith(
    `${window.location.origin}/shared/${"a".repeat(43)}`,
  );
  fireEvent.click(screen.getByText("Close"));
  fireEvent.click(screen.getByText("Share"));
  await screen.findByText("Sharing disabled");
  expect(screen.queryByLabelText("Share link")).toBeNull();
});
it("requires confirmation to rotate or revoke and never recovers a token from status", async () => {
  vi.mocked(getSharingStatus).mockResolvedValue(enabled);
  mount();
  await screen.findByText("Sharing enabled");
  expect(screen.queryByText("Copy link")).toBeNull();
  fireEvent.click(screen.getByText("Rotate link"));
  expect(createShareLink).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Confirm rotate"));
  await screen.findByLabelText("Share link");
  expect(createShareLink).toHaveBeenCalledWith("trip-id", true);
  fireEvent.click(screen.getByText("Disable sharing"));
  expect(disableSharing).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Confirm disable"));
  await screen.findByText("Sharing disabled");
  expect(disableSharing).toHaveBeenCalledWith("trip-id");
  expect(screen.queryByLabelText("Share link")).toBeNull();
});
it("shows creation and clipboard errors", async () => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(new Error("Denied")) },
  });
  mount();
  fireEvent.click(await screen.findByText("Enable sharing"));
  await screen.findByLabelText("Share link");
  fireEvent.click(screen.getByText("Copy link"));
  await screen.findByText(/Could not copy/);
  vi.mocked(createShareLink).mockRejectedValue(
    new Error("Sharing state changed"),
  );
  fireEvent.click(screen.getByText("Rotate link"));
  fireEvent.click(screen.getByText("Confirm rotate"));
  await screen.findByText("Something went wrong. Please try again.");
});
