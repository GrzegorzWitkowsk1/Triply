import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TRIP_STATUS_VALUES, type TripStatus, type TripSummary } from "@triply/shared";
import { deleteTrip, listTrips } from "../api/trips";
import i18n from "../i18n";
import MyTripsPage from "./MyTripsPage";

vi.mock("../api/trips", () => ({ listTrips: vi.fn(), deleteTrip: vi.fn() }));
vi.mock("../hooks/useGuestUsage", () => ({
  GUEST_USAGE_KEY: ["guest", "usage"],
  useGuestUsage: () => ({ isGuest: false }),
}));

function trip(status: TripStatus): TripSummary {
  return {
    id: status,
    status,
    destination: status === "generating" ? "Prague" : `${status} destination`,
    country: "",
    prompt: "",
    badges: [],
    startDate: null,
    endDate: null,
    durationDays: 3,
    travelers: 1,
    budget: { amount: null, currency: null, type: null },
    location: null,
    fixtureKey: null,
    createdAt: null,
    updatedAt: null,
  };
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/trips"]}>
        <Routes>
          <Route path="/trips" element={<MyTripsPage />} />
          <Route path="/trips/:id" element={<p>Trip details</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.mocked(listTrips).mockResolvedValue(TRIP_STATUS_VALUES.map(trip));
  vi.mocked(deleteTrip).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("matches every filter to card statuses, including generating Prague and failed trips", async () => {
  mount();
  await screen.findByText("Prague");
  expect(screen.getAllByRole("article")).toHaveLength(4);

  fireEvent.click(screen.getByRole("button", { name: "Planning" }));
  expect(screen.getAllByRole("article")).toHaveLength(2);
  expect(screen.getByText("Prague")).toBeTruthy();
  expect(screen.getByText("draft destination")).toBeTruthy();
  expect(screen.queryByText("failed destination")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Failed" }));
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(screen.getByText("failed destination")).toBeTruthy();
  expect(screen.queryByText("Prague")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Ready" }));
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(screen.getByText("ready destination")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "All trips" }));
  expect(screen.getAllByRole("article")).toHaveLength(4);
});

it("opens deletion from inside the card, supports cancellation and deletes the selected trip", async () => {
  const client = mount();
  const city = await screen.findByText("Prague");
  const card = city.closest("article")!;
  const deleteButton = within(card).getByRole("button", { name: "Delete trip Prague" });
  expect(within(card).getByRole("button", { name: "View trip" })).toBeTruthy();

  fireEvent.click(deleteButton);
  let dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(deleteTrip).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

  fireEvent.click(deleteButton);
  dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete trip" }));
  await waitFor(() => expect(deleteTrip).toHaveBeenCalledWith("generating", expect.anything()));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  client.clear();
});

it("keeps View trip navigation working", async () => {
  mount();
  const city = await screen.findByText("Prague");
  fireEvent.click(within(city.closest("article")!).getByRole("button", { name: "View trip" }));
  expect(await screen.findByText("Trip details")).toBeTruthy();
});
