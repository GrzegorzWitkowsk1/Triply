import { createHash, randomUUID } from "node:crypto";
import mongoose from "mongoose";
import type { FastifyRequest } from "fastify";
import { addDays, isIsoDate, type GuestErrorCode, type GuestUsage, type TripAnalysis } from "@triply/shared";
import { env } from "../config/env.js";
import { currentTripOwner, guestOwnerId, ownerFilter } from "../middleware/tripIdentity.js";
import { TripModel, type TripDocument } from "../models/Trip.js";

const WINDOW = 24 * 60 * 60 * 1000;
type Kind = "generation" | "day";
interface Entry { id: string; kind: Kind; fingerprint: string; at: Date; state: "reserved" | "started" | "completed" | "failed"; result?: string; }
interface Ledger { _id: string; entries: Entry[]; expiresAt?: Date; }
const ledger = () => mongoose.connection.db!.collection<Ledger>("guest_usage", { writeConcern: { w: "majority", wtimeoutMS: 5_000 } });
export async function prepareGuestLimits(): Promise<void> {
  await ledger().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await TripModel.collection.createIndex({ guestId: 1, guestSlot: 1 }, { unique: true,
    partialFilterExpression: { guestId: { $type: "string" }, guestSlot: { $type: "number" } } });
}
const limit = (kind: Kind) => kind === "generation" ? env.GUEST_AI_GENERATIONS_PER_24H : env.GUEST_DAY_REGENERATIONS_PER_24H;
export class GuestLimitError extends Error {
  readonly expose = true;
  constructor(readonly code: GuestErrorCode | "IDEMPOTENCY_CONFLICT", message: string, readonly status: number,
    readonly details: Record<string, unknown> = {}, readonly resetsAt?: string) { super(message); }
}

export function validateGuestDuration(owner: string, analysis: Pick<TripAnalysis, "startDate" | "endDate" | "durationDays">): void {
  if (!guestOwnerId(owner)) return;
  const max = env.GUEST_MAX_TRIP_DAYS;
  // Dates are destination-local YYYY-MM-DD labels, advanced by calendar arithmetic.
  const tooLong = analysis.startDate && analysis.endDate && isIsoDate(analysis.startDate) && isIsoDate(analysis.endDate)
    ? analysis.endDate > addDays(analysis.startDate, max - 1) : false;
  if (tooLong || (analysis.durationDays ?? 0) > max) throw new GuestLimitError("GUEST_TRIP_DURATION_EXCEEDED",
    `Guest trips can contain at most ${max} calendar days. Shorten your trip to continue.`, 400, { maxTripDays: max });
}

/** Unique (guestId, guestSlot) makes each persisted draft its own atomic reservation. */
export async function reserveGuestDraft(owner: string, prompt: string, badges: string[]): Promise<TripDocument> {
  const guestId = guestOwnerId(owner);
  if (!guestId) throw new Error("Guest identity required");
  // Explicit index creation also protects production with autoIndex disabled.
  await TripModel.collection.createIndex({ guestId: 1, guestSlot: 1 }, { unique: true,
    partialFilterExpression: { guestId: { $type: "string" }, guestSlot: { $type: "number" } } });
  // After a limit decrease, derive a prefix whose capacity plus all retained
  // slots outside it fits the limit. Shrinking can expose further retained slots.
  // Concurrent creators share its unique slots; deletion can only expand capacity.
  const occupied = await TripModel.find(ownerFilter(owner)).select("guestSlot").lean().exec();
  let availableRange = env.GUEST_MAX_TRIPS;
  for (const slot of occupied.map(trip => trip.guestSlot ?? Infinity).sort((a, b) => b - a)) {
    if (slot >= availableRange) availableRange = Math.max(0, availableRange - 1);
  }
  for (let guestSlot = 0; guestSlot < availableRange; guestSlot++) {
    try {
      return await TripModel.create({ guestId, guestSlot, prompt, badges, status: "draft", analysis: {
        destination: null, country: null, startDate: null, endDate: null, durationDays: null, travelers: null,
        budget: { amount: null, currency: null, type: null }, interests: badges, pace: null,
        maxWalkingDistanceKm: null, notes: null, location: null,
      } });
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error;
    }
  }
  throw new GuestLimitError("GUEST_TRIP_LIMIT_REACHED",
    `You've reached the ${env.GUEST_MAX_TRIPS}-trip guest limit. Delete an existing trip or create an account to continue.`, 409,
    { tripCount: await TripModel.countDocuments(ownerFilter(owner)), tripLimit: env.GUEST_MAX_TRIPS });
}

export async function guestUsage(owner: string): Promise<GuestUsage> {
  const guestId = guestOwnerId(owner);
  if (!guestId) throw new GuestLimitError("GUEST_SESSION_EXPIRED", "Your guest session has expired. Enter Guest Mode again to start a new session.", 401);
  const entries = (await ledger().findOne({ _id: guestId }))?.entries.filter(e => e.at.getTime() > Date.now() - WINDOW) ?? [];
  const remaining = (kind: Kind) => Math.max(0, limit(kind) - entries.filter(e => e.kind === kind).length);
  const reset = (kind: Kind) => {
    const times = entries.filter(e => e.kind === kind).map(e => e.at.getTime() + WINDOW).sort((a, b) => a - b);
    // Also correct when an operator lowers a configured limit below existing usage.
    return times.length ? new Date(times[Math.max(0, times.length - limit(kind))]).toISOString() : null;
  };
  return { tripCount: await TripModel.countDocuments(ownerFilter(owner)), tripLimit: env.GUEST_MAX_TRIPS,
    aiGenerationsRemaining: remaining("generation"), aiGenerationsLimit: limit("generation"),
    dayRegenerationsRemaining: remaining("day"), dayRegenerationsLimit: limit("day"),
    maxTripDays: env.GUEST_MAX_TRIP_DAYS, aiQuotaResetsAt: reset("generation"), dayQuotaResetsAt: reset("day") };
}

/** Quota accounting wraps existing operations; it does not replace the generation claim/version locks. */
export async function guestOperation<T>(request: FastifyRequest, kind: Kind, work: (start: () => Promise<void>) => Promise<T>): Promise<T> {
  const guestId = guestOwnerId(currentTripOwner(request));
  if (!guestId) return work(async () => {});
  const key = request.headers["idempotency-key"];
  if (key !== undefined && (typeof key !== "string" || key.length < 1 || key.length > 128)) {
    throw Object.assign(new Error("Use an idempotency key of 1–128 characters."), { expose: true, status: 400 });
  }
  const id = createHash("sha256").update(`${kind}:${key ?? randomUUID()}`).digest("hex");
  const fingerprint = createHash("sha256").update(JSON.stringify([request.url, request.body ?? null])).digest("hex");
  const now = new Date();
  try { await ledger().updateOne({ _id: guestId }, { $setOnInsert: { entries: [] } }, { upsert: true }); }
  catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error; }
  const active = { $filter: { input: "$entries", as: "e", cond: { $gt: ["$$e.at", new Date(now.getTime() - WINDOW)] } } };
  const entry: Entry = { id, kind, at: now, fingerprint, state: "reserved" };
  const reserved = await ledger().findOneAndUpdate({ _id: guestId, entries: { $not: { $elemMatch: { id, at: { $gt: new Date(now.getTime() - WINDOW) } } } },
    $expr: { $lt: [{ $size: { $filter: { input: active, as: "e", cond: { $eq: ["$$e.kind", kind] } } } }, limit(kind)] },
  }, [{ $set: { entries: { $concatArrays: [active, [{ $literal: entry }]] }, expiresAt: new Date(now.getTime() + 7 * WINDOW) } }], { returnDocument: "after" });
  if (!reserved) {
    const previous = (await ledger().findOne({ _id: guestId }))?.entries.find(e => e.id === id && e.at.getTime() > now.getTime() - WINDOW);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new GuestLimitError("IDEMPOTENCY_CONFLICT", "This request key was already used for different input.", 409);
      if (previous.state === "completed" && previous.result) return JSON.parse(previous.result) as T;
      throw new GuestLimitError("IDEMPOTENCY_CONFLICT", "This request has already started. Reload your trip before retrying with a new request key.", 409);
    }
    const usage = await guestUsage(currentTripOwner(request));
    throw new GuestLimitError(kind === "generation" ? "GUEST_AI_LIMIT_REACHED" : "GUEST_DAY_REGEN_LIMIT_REACHED",
      kind === "generation" ? `You've used your ${limit(kind)} itinerary generations for the last 24 hours. You can still view and edit your trips.`
        : `You've used your ${limit(kind)} AI day regenerations for the last 24 hours. You can still edit your itinerary manually.`, 429,
      {}, (kind === "generation" ? usage.aiQuotaResetsAt : usage.dayQuotaResetsAt) ?? undefined);
  }
  let started = false;
  const start = async () => {
    if (started) return;
    const result = await ledger().updateOne({ _id: guestId, entries: { $elemMatch: { id, state: "reserved" } } },
      { $set: { "entries.$.state": "started", "entries.$.at": new Date() } });
    if (!result.modifiedCount) throw new Error("Quota reservation is unavailable");
    started = true;
  };
  try {
    const result = await work(start);
    await ledger().updateOne({ _id: guestId, "entries.id": id }, { $set: { "entries.$.state": "completed", "entries.$.result": JSON.stringify(result) } });
    return result;
  } catch (error) {
    // No refund after a provider boundary, including timeouts, disconnects, and uncertain writes.
    if (started) await ledger().updateOne({ _id: guestId, "entries.id": id }, { $set: { "entries.$.state": "failed" } });
    else await ledger().updateOne({ _id: guestId }, { $pull: { entries: { id } } });
    throw error;
  }
}
