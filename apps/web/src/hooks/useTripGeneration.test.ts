import { afterEach, describe, expect, it, vi } from "vitest";
import type { TripDetail } from "@triply/shared";
import { ApiError } from "../api/client";
import { generateTrip, getTrip } from "../api/trips";
import { generateTripOnce } from "./useTripGeneration";

vi.mock("../api/trips", () => ({ generateTrip: vi.fn(), getTrip: vi.fn(), confirmTrip: vi.fn() }));
afterEach(() => vi.resetAllMocks());

describe("generation requests", () => {
  it("shares a pending request and permits retry after it fails", async () => {
    let reject!: (error: Error) => void;
    vi.mocked(generateTrip).mockReturnValueOnce(new Promise((_resolve, rejectRequest) => { reject = rejectRequest; }));
    const first = generateTripOnce("trip-1");
    const second = generateTripOnce("trip-1");
    expect(first).toBe(second);
    expect(generateTrip).toHaveBeenCalledTimes(1);
    reject(new ApiError("Unavailable", 502));
    await expect(first).rejects.toThrow("Unavailable");
    vi.mocked(generateTrip).mockResolvedValueOnce({ id: "trip-1", status: "ready" } as TripDetail);
    expect((await generateTripOnce("trip-1")).status).toBe("ready");
    expect(generateTrip).toHaveBeenCalledTimes(2);
  });

  it.each(["generating", "ready"] as const)("uses the server's %s state after a conflict", async (status) => {
    vi.mocked(generateTrip).mockRejectedValueOnce(new ApiError("Already generating", 409));
    vi.mocked(getTrip).mockResolvedValueOnce({ id: "trip-2", status } as TripDetail);
    expect((await generateTripOnce("trip-2")).status).toBe(status);
    expect(getTrip).toHaveBeenCalledWith("trip-2");
  });

  it("does not hide a conflict when the server has no ongoing or completed generation", async () => {
    vi.mocked(generateTrip).mockRejectedValueOnce(new ApiError("Conflict", 409));
    vi.mocked(getTrip).mockResolvedValueOnce({ id: "trip-3", status: "failed" } as TripDetail);
    await expect(generateTripOnce("trip-3")).rejects.toThrow("Conflict");
  });
});
