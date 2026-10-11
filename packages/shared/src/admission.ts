import { z } from "zod";
import type { ItineraryDay, TripAttraction } from "./trip.js";

export const admissionPriceSchema = z.object({
  amountMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().regex(/^[A-Z]{3}$/),
  fractionDigits: z.number().int().min(0).max(3),
  priceType: z.enum(["adult", "general"]),
  unit: z.enum(["per_person", "per_group", "unknown"]),
});
export const attractionAdmissionSchema = z.object({
  status: z.enum(["free", "paid", "unknown"]),
  price: admissionPriceSchema.nullable(),
  source: z.enum(["osm", "official"]).nullable(),
  sourceUrl: z.string().max(2000).nullable(),
  checkedAt: z.string().max(120).nullable(),
  retrievedAt: z.string().max(120).nullable(),
  rawFee: z.string().max(10000).nullable(),
  rawCharge: z.string().max(10000).nullable(),
  rawFeeConditional: z.string().max(10000).nullable(),
  rawChargeConditional: z.string().max(10000).nullable(),
  rawCurrency: z.string().max(10000).nullable(),
  menuUrl: z.string().max(2000).nullable(),
  notes: z.string().max(10000).nullable(),
});
export type AttractionAdmission = z.infer<typeof attractionAdmissionSchema>;
export type AdmissionPrice = z.infer<typeof admissionPriceSchema>;
export interface AdmissionSummary {
  knownAdmissionTotals: { currency: string; fractionDigits: number; amountMinor: number; unit: AdmissionPrice["unit"] }[];
  freeAttractions: number;
  paidWithKnownPrice: number;
  paidWithUnknownPrice: number;
  unknownAdmission: number;
  isComplete: boolean;
}
export function formatAdmissionPrice(price: AdmissionPrice): string {
  return new Intl.NumberFormat("en", { style: "currency", currency: price.currency }).format(price.amountMinor / 10 ** price.fractionDigits);
}
export function admissionLabel(admission?: AttractionAdmission | null): string {
  if (admission?.rawFeeConditional || admission?.rawChargeConditional) return "Conditional admission fee";
  if (admission?.status === "free") return "Free admission";
  if (admission?.status === "paid") return admission.price
    ? `${formatAdmissionPrice(admission.price)} admission${admission.price.unit === "per_person" ? " per person" : admission.price.unit === "per_group" ? " per group" : " (unit unconfirmed)"}`
    : "Paid admission — price unavailable";
  return "Admission price unavailable";
}
/** Counts activity records once, never both activities and map stops. Units remain separate. */
export function summarizeAdmission(days: readonly ItineraryDay[], attractions: readonly TripAttraction[], travelers?: number | null): AdmissionSummary {
  const summary: AdmissionSummary = { knownAdmissionTotals: [], freeAttractions: 0, paidWithKnownPrice: 0, paidWithUnknownPrice: 0, unknownAdmission: 0, isComplete: true };
  const seen = new Set<string>();
  for (const day of days) for (const activity of day.activities) {
    if (activity.type !== "attraction") continue;
    const key = `${day.dayIndex}:${activity.placeId ?? activity.title}:${activity.startTime}:${activity.endTime}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const stop = day.stops.find(p => activity.placeId ? p.placeId === activity.placeId : p.name === activity.title);
    const matches = attractions.filter(p => activity.placeId ? p.placeId === activity.placeId : p.name === activity.title && p.lat === stop?.lat && p.lng === stop?.lng);
    const admission = matches.length === 1 ? matches[0].admission : stop?.admission;
    if (admission?.status === "free") summary.freeAttractions++;
    else if (admission?.status === "paid" && admission.price && admissionPriceSchema.safeParse(admission.price).success) {
      summary.paidWithKnownPrice++;
      const price = admission.price;
      const count = price.unit === "per_person" && Number.isSafeInteger(travelers) && travelers! > 0 && travelers! <= 50 ? travelers! : 1;
      let total = summary.knownAdmissionTotals.find(t => t.currency === price.currency && t.unit === price.unit && t.fractionDigits === price.fractionDigits);
      if (!total) { total = { currency: price.currency, fractionDigits: price.fractionDigits, unit: price.unit, amountMinor: 0 }; summary.knownAdmissionTotals.push(total); }
      const next = total.amountMinor + price.amountMinor * count;
      if (Number.isSafeInteger(next)) total.amountMinor = next;
      else summary.isComplete = false;
      if (price.unit === "unknown" || (price.unit === "per_person" && count === 1 && travelers !== 1)) summary.isComplete = false;
    } else if (admission?.status === "paid") summary.paidWithUnknownPrice++;
    else summary.unknownAdmission++;
  }
  summary.isComplete = summary.isComplete && summary.paidWithUnknownPrice === 0 && summary.unknownAdmission === 0;
  return summary;
}
