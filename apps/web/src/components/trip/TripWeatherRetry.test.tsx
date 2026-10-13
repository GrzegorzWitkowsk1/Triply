import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { WeatherAvailability } from "@triply/shared";
import TripWeatherRetry from "./TripWeatherRetry";

const state = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false, error: null as Error | null }));
vi.mock("../../hooks/useTripWeather", () => ({ useRefreshTripWeather: () => state }));
const availability: WeatherAvailability = { status: "temporarily_unavailable", reason: "network", canRetry: true,
  checkedAt: null, retryAfter: null, timeZone: "Europe/Rome", forecastStart: "2026-10-12", forecastEnd: "2026-10-27" };
beforeEach(() => { vi.clearAllMocks(); state.isPending = false; state.error = null; });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("contextual weather retry", () => {
  it("keeps distant forecast status and a disabled refresh icon visible until destination noon", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
    render(<TripWeatherRetry tripId="rome" availability={{ ...availability, status: "not_yet_available", reason: "future_dates",
      retryAfter: "2026-11-05T11:00:00Z" }} />);
    expect(screen.getByRole("status").textContent).toContain("5 Nov 2026, 12:00");
    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
  });
  it("retries only weather and shows loading without allowing duplicate clicks", () => {
    const view = render(<TripWeatherRetry tripId="rome" availability={availability} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry weather" }));
    expect(state.mutate).toHaveBeenCalledWith("rome");
    state.isPending = true; view.rerender(<TripWeatherRetry tripId="rome" availability={availability} />);
    expect(screen.getByRole("button", { name: "Retrying weather…" }).hasAttribute("disabled")).toBe(true);
  });

  it("shows an actionable refresh error", () => {
    state.error = new Error("Destination lookup is temporarily unavailable. Please try again.");
    render(<TripWeatherRetry tripId="rome" availability={availability} />);
    expect(screen.getByRole("alert").textContent).toContain("Weather could not be refreshed");
  });

  it("shows future availability without a pointless retry action", () => {
    render(<TripWeatherRetry tripId="rome" availability={{ ...availability, status: "not_yet_available", reason: "future_dates", canRetry: false }} />);
    expect(screen.getByText("Forecast not available yet. Check again closer to your trip.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry weather" })).toBeTruthy();
  });

  it("shows partial availability and retries supported missing days", () => {
    render(<TripWeatherRetry tripId="rome" date="2026-10-12" availability={{ ...availability, status: "partial", reason: "missing_days" }} />);
    expect(screen.getByText("Weather forecasts are available for some days only.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry weather" })).toBeTruthy();
  });

  it("explains a selected future day in a partial trip", () => {
    render(<TripWeatherRetry tripId="rome" date="2026-11-01" availability={{ ...availability, status: "partial" }} />);
    expect(screen.getByText("Forecast will be available from 2026-10-17 at 12:00 (Europe/Rome).")).toBeTruthy();
    expect(screen.getByRole("button")).toBeTruthy();
  });

  it("keeps past-date messaging distinct from future forecasts", () => {
    render(<TripWeatherRetry tripId="rome" availability={{ ...availability, status: "unsupported_past", canRetry: false }} />);
    expect(screen.getByText("Forecasts are unavailable for past dates. Historical weather is not shown.")).toBeTruthy();
    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
  });

  it("enables retry after the provider cooldown expires", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
    render(<TripWeatherRetry tripId="rome" availability={{ ...availability, status: "rate_limited", retryAfter: "2026-10-12T12:00:01Z" }} />);
    expect(screen.getByRole("button", { name: "Retry weather" }).hasAttribute("disabled")).toBe(true);
    const { act } = await import("@testing-library/react");
    await act(async () => { await vi.advanceTimersByTimeAsync(1001); });
    expect(screen.getByRole("button", { name: "Retry weather" }).hasAttribute("disabled")).toBe(false);
  });

  it("removes unavailable messaging after successful refresh", () => {
    const view = render(<TripWeatherRetry tripId="rome" availability={availability} />);
    view.rerender(<TripWeatherRetry tripId="rome" availability={{ ...availability, status: "available", reason: null, canRetry: false }} />);
    expect(screen.getByRole("status").textContent).toBe("Weather available"); expect(screen.getByRole("button")).toBeTruthy();
  });
});
