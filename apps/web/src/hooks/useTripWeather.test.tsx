import type { PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { TripDetail, TripWeatherRefresh } from "@triply/shared";
import { refreshTripWeather } from "../api/trips";
import { refreshWeatherOnce, useRefreshTripWeather } from "./useTripWeather";
import { tripQueryKey } from "./useTrips";

vi.mock("../api/trips", () => ({ refreshTripWeather: vi.fn(), getTrip: vi.fn(), listTrips: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const result: TripWeatherRefresh = { id: "rome", weather: [{ date: "2026-10-12", weatherCode: 0, temperatureMax: 22 }],
  weatherAvailability: { status: "available", reason: null, canRetry: false, checkedAt: "2026-10-12T12:00:00Z", retryAfter: null,
    timeZone: "Europe/Rome", forecastStart: "2026-10-12", forecastEnd: "2026-10-27" }, weatherIssues: [], updatedAt: "2026-10-12T12:00:00Z" };

describe("weather refresh query mutation", () => {
  it("does not overwrite a newer cached weather result with a delayed response", async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const current = { id: "rome", weather: [{ date: "2026-10-12", weatherCode: 0, temperatureMax: 30 }],
      updatedAt: "2026-10-12T12:01:00Z", weatherAvailability: { ...result.weatherAvailability, checkedAt: "2026-10-12T12:01:00Z" } } as TripDetail;
    client.setQueryData(tripQueryKey("rome"), current);
    const initial = client.getQueryData(tripQueryKey("rome"));
    vi.mocked(refreshTripWeather).mockResolvedValue(result);
    const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const hook = renderHook(() => useRefreshTripWeather(), { wrapper });
    act(() => hook.result.current.mutate("rome"));
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(client.getQueryData(tripQueryKey("rome"))).toBe(initial);
    client.clear();
  });
  it("patches only weather and its diagnostics without refetching or replacing itinerary/budget caches", async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const current = { id: "rome", weather: [], itinerary: { days: [{ dayIndex: 1, activities: ["unsaved-order"] }] },
      itineraryVersion: 8, analysis: { notes: "local preferences" }, budgetData: { marker: "keep" },
      quality: { valid: true, score: 70, dimensions: { marker: "keep" }, issues: [
        { code: "WEATHER_UNAVAILABLE", message: "Old warning" }, { code: "ROUTE_ESTIMATED", message: "Keep routing warning" },
      ] } } as unknown as TripDetail;
    client.setQueryData(tripQueryKey("rome"), current);
    client.setQueryData(["trip-budget", "rome"], { expenses: ["keep"] });
    const initial = client.getQueryData<TripDetail>(tripQueryKey("rome"))!;
    const budget = client.getQueryData(["trip-budget", "rome"]);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    vi.mocked(refreshTripWeather).mockResolvedValue(result);
    const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const hook = renderHook(() => useRefreshTripWeather(), { wrapper });
    act(() => hook.result.current.mutate("rome"));
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    const updated = client.getQueryData<TripDetail>(tripQueryKey("rome"))!;
    expect(updated.weather).toEqual(result.weather);
    expect(updated.weatherAvailability?.status).toBe("available");
    expect(updated.quality?.issues.map(issue => issue.code)).toEqual(["ROUTE_ESTIMATED"]);
    expect(updated.quality?.score).toBe(70);
    expect(updated.itinerary).toBe(initial.itinerary); expect(updated.analysis).toBe(initial.analysis);
    expect(updated.itineraryVersion).toBe(8); expect(updated.budgetData).toBe(initial.budgetData);
    expect(client.getQueryData(["trip-budget", "rome"])).toBe(budget);
    expect(invalidate).not.toHaveBeenCalled(); client.clear();
  });

  it("shares repeated requests and allows another attempt after failure", async () => {
    let reject!: (error: Error) => void;
    vi.mocked(refreshTripWeather).mockReturnValueOnce(new Promise((_resolve, rejectRequest) => { reject = rejectRequest; }));
    const first = refreshWeatherOnce("rome"); const second = refreshWeatherOnce("rome");
    expect(first).toBe(second); expect(refreshTripWeather).toHaveBeenCalledTimes(1);
    reject(new Error("Unavailable")); await expect(first).rejects.toThrow("Unavailable");
    vi.mocked(refreshTripWeather).mockResolvedValueOnce(result);
    expect((await refreshWeatherOnce("rome")).weatherAvailability.status).toBe("available");
    expect(refreshTripWeather).toHaveBeenCalledTimes(2);
  });
});
