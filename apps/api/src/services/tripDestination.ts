import { guestWrite } from "../middleware/guestActivity.js";
import { checkOperation, generationContext } from "./generationContext.js";
import { ownerFilter, storedOwner } from "../middleware/tripIdentity.js";
import { isIsoDate, LIMITS, tripLocationSchema } from "@triply/shared";
import { TripModel, type TripDocument } from "../models/Trip.js";
import { DestinationResolutionError, resolveDestination } from "./location.js";

const recovering = new Map<string, Promise<TripDocument>>();

export function validateGenerationRequirements(trip: TripDocument): void {
  const { destination, country, durationDays, startDate, endDate } = trip.analysis;
  if (!Number.isInteger(durationDays) || !durationDays || durationDays < 1 || durationDays > LIMITS.durationDays ||
      (startDate != null && !isIsoDate(startDate)) || (endDate != null && !isIsoDate(endDate)) ||
      (startDate && endDate && endDate < startDate)) {
    throw new DestinationResolutionError("Please select your trip dates or duration before generating your itinerary.");
  }
  if (!destination?.trim()) {
    throw new DestinationResolutionError("Please select a destination before generating your trip.");
  }
  if (!country?.trim()) {
    throw new DestinationResolutionError("Please select the destination country before generating your trip.");
  }
}

/** Single-flight per trip snapshot; updates only location, without changing itinerary versions. */
export function recoverTripDestination(trip: TripDocument): Promise<TripDocument> {
  checkOperation();
  if (tripLocationSchema.safeParse(trip.analysis.location).success) return Promise.resolve(trip);
  if (generationContext.getStore()) return recover(trip);
  const key = JSON.stringify([trip.id, trip.updatedAt, trip.analysis.destination, trip.analysis.country]);
  const pending = recovering.get(key);
  if (pending) return pending;
  const recovery = recover(trip).finally(() => recovering.delete(key));
  recovering.set(key, recovery);
  return recovery;
}

async function recover(trip: TripDocument): Promise<TripDocument> {
  const { destination, country } = trip.analysis;
  const location = await resolveDestination(destination ?? "", country);
  checkOperation();
  const saved = await guestWrite(session => {
    checkOperation();
    return TripModel.findOneAndUpdate({
    _id: trip._id, ...ownerFilter(storedOwner(trip)), updatedAt: trip.updatedAt,
    ...(trip.status === "generating" ? { status: "generating", "generation.runId": trip.generation.runId,
      "generation.expiresAt": { $gt: new Date(Date.now()) }, $expr: { $gt: ["$generation.expiresAt", "$$NOW"] } } : {}),
    "analysis.destination": destination, "analysis.country": country,
    "analysis.location.lat": trip.analysis.location?.lat ?? null,
    "analysis.location.lng": trip.analysis.location?.lng ?? null,
    }, { $set: { "analysis.location": location } }, { new: true, runValidators: true }).session(session).exec();
  });
  if (saved) return saved;
  // Another process may have recovered the same destination. Reuse its valid result.
  const current = await TripModel.findOne({ _id: trip._id, ...ownerFilter(storedOwner(trip)) }).exec();
  if (trip.status === "generating" && (!current || current.status !== "generating" ||
      current.generation.runId !== trip.generation.runId || current.generation.startedAt?.getTime() !== trip.generation.startedAt?.getTime())) {
    throw new DestinationResolutionError("The trip changed during destination lookup. Reload it and try again.", 409);
  }
  if (current && current.analysis.destination === destination && current.analysis.country === country &&
      tripLocationSchema.safeParse(current.analysis.location).success) return current;
  throw new DestinationResolutionError("The trip changed during destination lookup. Reload it and try again.", 409);
}
