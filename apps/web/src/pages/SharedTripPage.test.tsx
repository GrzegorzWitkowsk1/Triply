import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { PublicTrip } from "@triply/shared";
import SharedTripPage from "./SharedTripPage";
vi.mock("../components/ToastProvider", () => ({ useToast: () => vi.fn() }));
import { getPublicTrip } from "../api/sharing";
vi.mock("../api/sharing", () => ({ getPublicTrip: vi.fn() }));
vi.mock("../components/trip/TripMap", () => ({
  default: () => <div>Itinerary map</div>,
}));
beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const fixture: PublicTrip = {
  destination: "Paris",
  country: "France",
  startDate: "2030-06-01",
  endDate: "2030-06-02",
  durationDays: 2,
  location: { lat: 48, lng: 2 },
  weather: [],
  days: [1, 2].map((dayIndex) => ({
    dayIndex,
    date: `2030-06-0${dayIndex}`,
    timeZone: "Europe/Paris",
    activities: [
      {
        type: "attraction",
        title: `Museum ${dayIndex}`,
        startTime: "2030-06-01T09:00",
        endTime: "2030-06-01T10:00",
        durationMinutes: 60,
        stopIndex: 0,
        distanceMeters: null,
      },
      {
        type: "travel",
        title: "Travel",
        startTime: "",
        endTime: "",
        durationMinutes: 10,
        stopIndex: null,
        distanceMeters: 100,
      },
    ],
    stops: [
      {
        name: `Museum ${dayIndex}`,
        category: "culture",
        lat: 48,
        lng: 2,
        description: "Public description",
        address: "Public address",
      },
    ],
    geometry: null,
    travelMode: "walking",
    totalVisitMinutes: 60,
    totalTravelMinutes: 10,
    totalDistanceMeters: 100,
    partiallyEstimated: false,
  })),
};
function mount() {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/shared/token"]}>
        <Routes>
          <Route path="/shared/:shareToken" element={<SharedTripPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
it("renders an anonymous read-only itinerary, details, map, times and day navigation", async () => {
  vi.mocked(getPublicTrip).mockResolvedValue(fixture);
  mount();
  await screen.findByText("Paris, France");
  expect(screen.getByText("09:00")).toBeTruthy();
  expect(screen.getByText("Public description")).toBeTruthy();
  expect(screen.getByText("Itinerary map")).toBeTruthy();
  for (const label of [
    /Reorder/,
    /Remove attraction/,
    /Regenerate/,
    /Recalculate/,
    /Budget/,
    /Expense/,
    /Ask Triply/,
    /Edit attraction/,
  ])
    expect(screen.queryByRole("button", { name: label })).toBeNull();
  fireEvent.click(screen.getByLabelText("Next day"));
  expect(screen.getByText(/Day 2 of 2/)).toBeTruthy();
});
it("shows generic errors for invalid and revoked shares and removes previously visible data", async () => {
  vi.mocked(getPublicTrip).mockResolvedValue(fixture);
  const client = mount();
  await screen.findByText("Paris, France");
  vi.mocked(getPublicTrip).mockRejectedValue(
    new Error("Private server diagnostic"),
  );
  await client.invalidateQueries({ queryKey: ["publicTrip", "token"] });
  await screen.findByRole("alert");
  expect(screen.queryByText("Paris, France")).toBeNull();
  expect(screen.queryByText("Private server diagnostic")).toBeNull();
});
it("handles initial public access failure without login", async () => {
  vi.mocked(getPublicTrip).mockRejectedValue(new Error("404"));
  mount();
  await screen.findByRole("alert");
  expect(screen.queryByText(/Sign in/)).toBeNull();
});
