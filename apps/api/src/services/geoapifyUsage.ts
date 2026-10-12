import { randomUUID } from "node:crypto";
import { ApiUsageModel } from "../models/ApiUsage.js";

export function utcUsageDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Places API: one credit per started batch of 20. Retain one for empty results. */
export function estimateGeoapifyCredits(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("Invalid Geoapify result limit");
  return Math.ceil(limit / 20);
}

export interface CreditReservation { id: string; date: string; credits: number }
const identity = (date: string) => ({ provider: "geoapify", service: "places", date });
const writeConcern = { w: "majority" as const, wtimeout: 5_000 };

export async function reserveGeoapifyCredits(credits: number, dailyLimit: number, now = new Date()): Promise<CreditReservation | null> {
  if (!Number.isSafeInteger(credits) || credits <= 0 || !Number.isSafeInteger(dailyLimit) || dailyLimit <= 0) return null;
  if (ApiUsageModel.db.readyState !== 1) return null;
  const date = utcUsageDate(now);
  const id = randomUUID();
  try {
    // Explicitly ensure uniqueness even when production disables automatic indexes.
    await ApiUsageModel.collection.createIndex({ provider: 1, service: 1, date: 1 }, { unique: true });
    try {
      await ApiUsageModel.updateOne(identity(date), { $setOnInsert: {
        reservedCredits: 0, consumedCredits: 0, requests: 0, reservations: [], updatedAt: now,
      } }, { upsert: true, writeConcern });
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error;
    }
    const result = await ApiUsageModel.updateOne({ ...identity(date),
      $expr: { $lte: [{ $add: ["$reservedCredits", "$consumedCredits", credits] }, dailyLimit] },
    }, { $inc: { reservedCredits: credits, requests: 1 }, $push: { reservations: { id, credits } }, $set: { updatedAt: now } }, { writeConcern });
    if (result.modifiedCount !== 1) {
      console.info({ event: "geoapify-quota-blocked", date, dailyLimit });
      return null;
    }
    return { id, date, credits };
  } catch {
    console.error({ event: "geoapify-quota-unavailable", date });
    return null;
  }
}

/** Idempotent settlement. Unknown billing consumes the full reservation. Crashes retain it. */
export async function settleGeoapifyCredits(reservation: CreditReservation, actualCredits = reservation.credits): Promise<void> {
  if (!Number.isSafeInteger(actualCredits) || actualCredits < 0 || actualCredits > reservation.credits) return;
  try {
    await ApiUsageModel.updateOne({ ...identity(reservation.date),
      reservations: { $elemMatch: { id: reservation.id, credits: reservation.credits } },
      reservedCredits: { $gte: reservation.credits },
    }, { $inc: { reservedCredits: -reservation.credits, consumedCredits: actualCredits },
      $pull: { reservations: { id: reservation.id } }, $set: { updatedAt: new Date() },
    }, { writeConcern });
  } catch {
    // No release on uncertain writes: the durable reservation still protects the budget.
    console.error({ event: "geoapify-settlement-unavailable", date: reservation.date });
  }
}
