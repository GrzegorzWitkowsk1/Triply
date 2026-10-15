import { ownerFilter, storedOwner } from "../middleware/tripIdentity.js";
import { type TripWeatherRefresh } from "@triply/shared";
import { TripModel, type TripDocument } from "../models/Trip.js";
import { DestinationResolutionError } from "./location.js";
import { recoverTripDestination } from "./tripDestination.js";
import { describeWeather, ensureWeatherData, type WeatherOptions } from "./weather.js";
import { weatherIssues } from "./weatherDiagnostics.js";
import { WEATHER_POLICY } from "./weatherPolicy.js";

interface PendingRefresh { request: Promise<TripDocument>; controller: AbortController; consumers: number; settled: boolean }
const pending = new Map<string, PendingRefresh>();

/** Both passive backfill and explicit refresh share a snapshot and a narrow optimistic update. */
export function refreshTripWeather(trip: TripDocument, options: WeatherOptions & { force?: boolean } = {}): Promise<TripDocument> {
  options.signal?.throwIfAborted();
  const key = JSON.stringify([trip.id, trip.updatedAt, Boolean(options.force)]);
  let entry = pending.get(key);
  if (!entry) {
    const controller = new AbortController();
    entry = { controller, consumers: 0, settled: false, request: Promise.resolve(trip) };
    const created = entry;
    created.request = refresh(trip, { ...options, signal: controller.signal }).finally(() => {
      created.settled = true;
      pending.delete(key);
    });
    pending.set(key, created);
  }
  const shared = entry;
  shared.consumers++;
  // A disconnected caller must not cancel another caller's shared refresh.
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = () => {
      if (done) return false;
      done = true;
      options.signal?.removeEventListener("abort", abort);
      shared.consumers--;
      if (!shared.consumers && !shared.settled) shared.controller.abort();
      return true;
    };
    const abort = () => { if (finish()) reject(options.signal?.reason); };
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    shared.request.then(value => { if (finish()) resolve(value); }, error => { if (finish()) reject(error); });
  });
}

async function refresh(trip: TripDocument, options: WeatherOptions & { force?: boolean }): Promise<TripDocument> {
  if (trip.status === "generating") throw new DestinationResolutionError("Please wait for itinerary generation to finish before refreshing weather.", 409);
  const now = options.now ?? new Date();
  const availability = describeWeather(trip.analysis, trip.weather, trip.weatherAvailability, now);
  if (options.force && availability.retryAfter && Date.parse(availability.retryAfter) > now.getTime()) {
    // Persist computed future availability for legacy trips too.
    await TripModel.updateOne({ _id: trip._id, updatedAt: trip.updatedAt }, { $set: { weatherAvailability: availability } }).exec();
    trip.set("weatherAvailability", availability);
    return trip;
  }
  if (options.force) {
    // Reserve the next attempt atomically so multiple tabs or API instances cannot bypass the limit.
    const claimed = await TripModel.findOneAndUpdate({ _id: trip._id, ...ownerFilter(storedOwner(trip)), updatedAt: trip.updatedAt,
      $or: [{ "weatherAvailability.retryAfter": null }, { "weatherAvailability.retryAfter": { $lte: now.toISOString() } }] },
    { $set: { weatherAvailability: { ...availability, retryAfter: new Date(now.getTime() + WEATHER_POLICY.failureCooldownMs).toISOString() } } }, { new: true }).exec();
    if (!claimed) return await TripModel.findById(trip._id).exec() ?? trip;
    // The reservation is for concurrent callers; this caller may perform the request.
    const previous = availability;
    trip = claimed;
    trip.set("weatherAvailability", previous);
  }
  const resolved = options.force ? await recoverTripDestination(trip) : trip;
  if (options.force) resolved.set("weatherAvailability", { ...resolved.weatherAvailability, retryAfter: availability.retryAfter });
  const result = await ensureWeatherData(resolved.analysis, resolved.weather, resolved.weatherFetchedAt, resolved.weatherAvailability, { ...options, now });
  options.signal?.throwIfAborted();
  if (JSON.stringify(resolved.toObject().weather) === JSON.stringify(result.days) &&
      JSON.stringify(resolved.toObject().weatherAvailability) === JSON.stringify(result.availability) &&
      resolved.weatherFetchedAt?.getTime() === result.fetchedAt?.getTime()) return resolved;
  const saved = await TripModel.findOneAndUpdate({
    _id: resolved._id, ...ownerFilter(storedOwner(resolved)), updatedAt: resolved.updatedAt,
    status: { $ne: "generating" },
    "analysis.startDate": resolved.analysis.startDate, "analysis.endDate": resolved.analysis.endDate,
    "analysis.location.lat": resolved.analysis.location?.lat ?? null,
    "analysis.location.lng": resolved.analysis.location?.lng ?? null,
    weatherFetchedAt: resolved.weatherFetchedAt,
    "weatherAvailability.checkedAt": resolved.weatherAvailability?.checkedAt ?? null,
  }, { $set: { weather: result.days, weatherFetchedAt: result.fetchedAt, weatherAvailability: result.availability } },
  { new: true, runValidators: true }).exec();
  if (!saved) throw new DestinationResolutionError("The trip changed while retrieving weather. Reload it and try again.", 409);
  return saved;
}

export function toWeatherRefresh(trip: TripDocument): TripWeatherRefresh {
  return { id: trip.id, weather: trip.toObject().weather,
    weatherAvailability: describeWeather(trip.analysis, trip.weather, trip.weatherAvailability),
    weatherIssues: weatherIssues(trip.toObject()), updatedAt: trip.updatedAt.toISOString() };
}
