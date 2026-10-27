import { localizeExplanation } from "./contentLanguage.js";
import { contentLocale, supportedLocaleSchema, type SupportedLocale } from "@triply/shared";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import mongoose, { Types } from "mongoose";
import { z } from "zod";
import { canonicalPackingName, LIMITS, PACKING_SUGGESTION_LIMIT, packingSuggestionInputSchema, packingSuggestionSchema, tripEquipmentItemSchema, type ApplyPackingSuggestions, type PackingApplyResult, type PackingPreview, type PackingContextStatus, type PackingSuggestion } from "@triply/shared";
import { aiService, AiError } from "../ai/index.js";
import type { PackingGenerationContext } from "../ai/prompts/packing.js";
import { env } from "../config/env.js";
import { ownerFilter } from "../middleware/tripIdentity.js";
import { TripModel, type TripDocument } from "../models/Trip.js";
import { EquipmentError, TRIP_NOT_FOUND } from "./equipment.js";
import { describeWeather } from "./weather.js";
import { WEATHER_POLICY } from "./weatherPolicy.js";

const PREVIEW_TTL_MS = 30 * 60_000;
const GENERATION_BUDGET_MS = 90_000;
interface PackingSnapshot {
  _id: Types.ObjectId;
  equipment: { _id: Types.ObjectId; name: string; count: number; category: import("@triply/shared").EquipmentCategory; packed: boolean }[];
  updatedAt?: Date;
  __v?: number;
}
const trips = () => mongoose.connection.db!.collection<PackingSnapshot>(TripModel.collection.name);
interface Lease { _id: string; claim: string; expiresAt: Date }
const leases = () => mongoose.connection.db!.collection<Lease>("packing_generation_leases");
export async function preparePacking(): Promise<void> {
  await leases().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}
export class PackingError extends Error {
  readonly expose = true;
  constructor(message: string, readonly status = 409) { super(message); }
}
async function ownedTrip(tripId: string, owner: string): Promise<TripDocument> {
  if (!Types.ObjectId.isValid(tripId)) throw new EquipmentError("trip-not-found", TRIP_NOT_FOUND, 404);
  const trip = await TripModel.findOne({ _id: tripId, ...ownerFilter(owner) }).exec();
  if (!trip) throw new EquipmentError("trip-not-found", TRIP_NOT_FOUND, 404);
  return trip;
}
const text = (value: string | null | undefined, max: number) => (value ?? "").normalize("NFKC")
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email omitted]")
  .replace(/\+?\d[\d ().-]{7,}\d/g, "[phone omitted]").slice(0, max);
export function packingContext(trip: TripDocument, now = new Date()): PackingGenerationContext {
  const a = trip.analysis;
  const availability = describeWeather(a, trip.weather, trip.weatherAvailability, now);
  const age = trip.weatherFetchedAt ? now.getTime() - trip.weatherFetchedAt.getTime() : Infinity;
  const fresh = age >= 0 && age < WEATHER_POLICY.cacheTtlMs;
  // Classification uses destination-local dates/horizon; old or future snapshots are never evidence.
  const days = fresh ? trip.weather.filter(day => day.date >= (a.startDate ?? "~") && day.date <= (a.endDate ?? "") &&
    day.date >= (availability.forecastStart ?? "~") && day.date <= (availability.forecastEnd ?? "")).slice(0, 16).map(day => ({
      date: day.date,
      ...(Number.isFinite(day.temperatureMax) ? { temperatureMax: day.temperatureMax } : {}),
      ...(Number.isInteger(day.weatherCode) && day.weatherCode >= 0 && day.weatherCode <= 99 ? { weatherCode: day.weatherCode } : {}),
    })).filter(day => day.temperatureMax !== undefined || day.weatherCode !== undefined) : [];
  const activities: PackingGenerationContext["activities"] = [];
  const seen = new Set<string>();
  const walkingDays: PackingGenerationContext["walkingDays"] = [];
  for (const day of trip.itinerary?.days.slice(0, 30) ?? []) {
    if (day.travelMode === "walking" && Number.isFinite(day.totalDistanceMeters) && day.totalDistanceMeters! > 0) {
      walkingDays.push({ day: day.dayIndex, distanceKm: Math.round(day.totalDistanceMeters! / 100) / 10 });
    }
    for (const activity of day.activities) {
      if (activities.length >= 50) break;
      const name = text(activity.title, 120);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const stop = day.stops.find(stop => stop.placeId && stop.placeId === activity.placeId) ?? day.stops.find(stop => stop.name === activity.title);
      const poi = stop ? trip.attractions.find(poi => stop.placeId ? poi.placeId === stop.placeId : poi.name === stop.name) : undefined;
      activities.push({ name, type: text(stop?.category ?? activity.type, 60),
        ...(poi?.environment === "outdoor" || poi?.environment === "indoor" ? { outdoor: poi.environment === "outdoor" } : {}) });
    }
  }
  return {
    destination: { city: text(a.destination, 120), country: a.country ? text(a.country, 80) : null },
    trip: { startDate: a.startDate, endDate: a.endDate, durationDays: a.durationDays, travelers: a.travelers ?? 1,
      pace: a.pace, interests: a.interests.slice(0, 12).map(value => text(value, 60)) },
    weather: { available: days.length > 0, status: !fresh ? "unknown_or_stale" : days.length ? (days.length === a.durationDays ? "confirmed_forecast" : "partial_forecast") : availability.status, days },
    activities, walkingDays,
    existingPackingItems: trip.equipment.slice(0, LIMITS.equipment).map(item => ({ name: text(item.name, 120), category: item.category ?? "other", count: item.count })),
  };
}
export function packingContextVersion(trip: TripDocument, locale: SupportedLocale = "en"): string {
  const { existingPackingItems: _inventory, ...context } = packingContext(trip);
  context.trip.interests = [...context.trip.interests].sort();
  return createHash("sha256").update(JSON.stringify([contentLocale(locale), context, trip.analysis.location ?? null, trip.itineraryVersion, trip.weatherFetchedAt])).digest("hex");
}
const envelopeSchema = z.object({
  version: z.literal(1), tripId: z.string(), owner: z.string(), expiresAt: z.number(), generatedAt: z.string(),
  locale: supportedLocaleSchema.optional(),
  contextVersion: z.string(), suggestions: z.array(packingSuggestionSchema).max(PACKING_SUGGESTION_LIMIT),
});
function sign(body: string): Buffer { return createHmac("sha256", env.SESSION_SECRET).update(`packing:v1:${body}`).digest(); }
function previewToken(envelope: z.infer<typeof envelopeSchema>): string {
  const body = Buffer.from(JSON.stringify(envelope)).toString("base64url");
  return `${body}.${sign(body).toString("base64url")}`;
}
function verifyToken(token: string, tripId: string, owner: string) {
  const [body, signature, extra] = token.split(".");
  const supplied = Buffer.from(signature ?? "", "base64url");
  const expected = sign(body ?? "");
  if (!body || extra || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new PackingError("Invalid packing preview. Generate suggestions again.", 400);
  let raw: unknown;
  try { raw = JSON.parse(Buffer.from(body, "base64url").toString()); } catch { throw new PackingError("Invalid packing preview.", 400); }
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success || parsed.data.tripId !== tripId || parsed.data.owner !== owner) throw new PackingError("This packing preview belongs to another trip or session. Generate suggestions again.", 400);
  if (parsed.data.expiresAt <= Date.now()) throw new PackingError("This packing preview expired. Generate suggestions again.", 410);
  return parsed.data;
}
export function normalizePackingOutput(raw: unknown, existingNames: string[], retainExisting = false): { suggestions: PackingSuggestion[]; warnings: string[] } {
  const parsed = z.object({ items: z.array(z.unknown()).max(PACKING_SUGGESTION_LIMIT), warnings: z.array(z.string().trim().min(1).max(240)).max(5) }).safeParse(raw);
  if (!parsed.success) throw new AiError("The AI returned no usable packing suggestions. Please try again.", 502, { code: "invalid_response" });
  const seen = new Set(retainExisting ? [] : existingNames.map(canonicalPackingName));
  const suggestions: PackingSuggestion[] = [];
  let invalid = false;
  for (const entry of parsed.data.items) {
    const item = packingSuggestionInputSchema.safeParse(entry);
    if (!item.success) { invalid = true; continue; }
    const name = item.data.name.normalize("NFKC").replace(/\s+/gu, " ").trim();
    const key = canonicalPackingName(name);
    if (!key || !packingSuggestionInputSchema.safeParse({ ...item.data, name }).success) { invalid = true; continue; }
    if (seen.has(key)) continue;
    seen.add(key);
    suggestions.push({ ...item.data, name, id: randomUUID() });
  }
  if (!suggestions.length && invalid) throw new AiError("The AI returned invalid packing suggestions. Please try again.", 502, { code: "invalid_response" });
  return { suggestions, warnings: invalid ? [...parsed.data.warnings, "Some invalid AI suggestions were removed."] : parsed.data.warnings };
}

/** Database lease protects across tabs and API processes, independently of guest accounting. */
export async function generatePacking(tripId: string, owner: string, start: () => Promise<void>, signal?: AbortSignal, locale: SupportedLocale = "en"): Promise<PackingPreview> {
  const trip = await ownedTrip(tripId, owner);
  if (!trip.analysis.destination?.trim()) throw new PackingError("Set a destination before generating packing suggestions.", 400);
  const claim = randomUUID();
  try {
    const reserved = await leases().findOneAndUpdate({ _id: tripId, expiresAt: { $lte: new Date() } },
      { $set: { claim, expiresAt: new Date(Date.now() + GENERATION_BUDGET_MS + 15_000) } }, { upsert: true, returnDocument: "after" });
    if (!reserved) throw new PackingError("Packing generation is already running for this trip. Wait and try again.");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) throw new PackingError("Packing generation is already running for this trip. Wait and try again.");
    throw error;
  }
  try {
    const budget = AbortSignal.timeout(GENERATION_BUDGET_MS);
    const combined = signal ? AbortSignal.any([signal, budget]) : budget;
    const context = { ...packingContext(trip), locale: contentLocale(locale) };
    combined.throwIfAborted();
    await start();
    let raw: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try { raw = await aiService.generatePacking(context, combined); break; }
      catch (error) {
        if (combined.aborted || attempt === 1 || !(error instanceof AiError) || !["unreachable", "unavailable", "rate_limited"].includes(error.code ?? "")) throw error;
      }
    }
    combined.throwIfAborted();
    const current = await ownedTrip(tripId, owner);
    const output = normalizePackingOutput(raw, current.equipment.map(item => item.name), true);
    const generatedAt = new Date().toISOString();
    const expiresAt = Date.now() + PREVIEW_TTL_MS;
    const contextVersion = packingContextVersion(trip, context.locale);
    const warnings = [...output.warnings];
    if (!context.weather.available) warnings.push("No reliable saved forecast is available. Suggestions use general trip and activity context.");
    else if (context.weather.status === "partial_forecast") warnings.push("Saved forecasts cover some trip days only; weather for other days is unknown.");
    if (contextVersion !== packingContextVersion(current, context.locale)) warnings.push("Your trip or packing list changed during generation. Review these suggestions carefully.");
    warnings.push("Suggestions are per traveler. Review quantities and any seasonal guidance before adding items.");
    const saved = await TripModel.updateOne({ _id: trip._id, ...ownerFilter(owner) }, { $set: {
      packingGeneration: { locale: context.locale, generatedAt, contextFingerprint: contextVersion, suggestionCount: output.suggestions.length },
    } }).exec();
    if (!saved.matchedCount) throw new EquipmentError("trip-not-found", TRIP_NOT_FOUND, 404);
    return { ...output, warnings: warnings.map(warning => localizeExplanation(warning, context.locale)), generatedAt, expiresAt: new Date(expiresAt).toISOString(), contextVersion,
      token: previewToken({ version: 1, tripId, owner, expiresAt, generatedAt, locale: context.locale, contextVersion, suggestions: output.suggestions }) };
  } finally { await leases().deleteOne({ _id: tripId, claim }); }
}

export async function applyPacking(tripId: string, owner: string, input: ApplyPackingSuggestions): Promise<PackingApplyResult> {
  await ownedTrip(tripId, owner);
  const preview = verifyToken(input.token, tripId, owner);
  const ids = new Set(input.selectedIds);
  if (preview.suggestions.filter(item => ids.has(item.id)).length !== ids.size) throw new PackingError("Select valid items from this preview.", 400);
  const selected = preview.suggestions.filter(item => ids.has(item.id));
  // Compare the raw persisted array so defaults on legacy records do not break CAS equality.
  for (let attempt = 0; attempt < 6; attempt++) {
    const current = await trips().findOne({ _id: new Types.ObjectId(tripId), ...ownerFilter(owner) });
    if (!current) throw new EquipmentError("trip-not-found", TRIP_NOT_FOUND, 404);
    const names = new Set(current.equipment.map(item => canonicalPackingName(item.name)));
    const skipped = selected.filter(item => names.has(canonicalPackingName(item.name))).map(item => item.id);
    const additions = selected.filter(item => !names.has(canonicalPackingName(item.name))).map(item => ({ _id: new Types.ObjectId(), name: item.name, category: item.category, count: item.count, packed: false, source: "ai" as const, reason: item.reason }));
    if (current.equipment.length + additions.length > LIMITS.equipment) throw new PackingError(`These items would exceed the ${LIMITS.equipment}-item packing limit. Select fewer items or remove an existing item.`, 400);
    const stale = preview.contextVersion !== packingContextVersion(TripModel.hydrate(current), preview.locale);
    if (stale && !input.allowStale) throw new PackingError("Your trip has changed since these suggestions were generated. Refresh suggestions or confirm that you want to use this outdated preview.");
    if (!additions.length) return { added: [], skipped, stale };
    const result = await trips().updateOne({ _id: current._id, ...ownerFilter(owner), equipment: current.equipment, updatedAt: current.updatedAt },
      { $push: { equipment: { $each: additions } }, $set: { updatedAt: new Date() }, $inc: { __v: 1 } });
    if (result.modifiedCount) return { added: additions.map(item => tripEquipmentItemSchema.parse({ ...item, id: item._id.toString() })), skipped, stale };
  }
  throw new PackingError("The checklist is changing in another tab. Please try adding the selected items again.");
}

/** Read-only status: no AI, weather lookup, quota reservation or trip mutation. */
export async function packingContextStatus(tripId: string, owner: string): Promise<PackingContextStatus> {
  const trip = await ownedTrip(tripId, owner);
  const contextFingerprint = packingContextVersion(trip, trip.packingGeneration?.locale);
  const stored = trip.packingGeneration;
  const generation = stored ? { locale: stored.locale, generatedAt: stored.generatedAt, contextFingerprint: stored.contextFingerprint, suggestionCount: stored.suggestionCount } : null;
  return { contextFingerprint, generation, outdated: !!generation && generation.contextFingerprint !== contextFingerprint };
}
