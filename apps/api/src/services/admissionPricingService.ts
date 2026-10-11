import type { AttractionAdmission, AdmissionPrice } from "@triply/shared";

const currencies = new Set(Intl.supportedValuesOf("currency"));
const symbols: Record<string, string> = { "€": "EUR", "£": "GBP" };
function parseCharge(raw: string | null, rawCurrency: string | null): AdmissionPrice | null {
  if (!raw) return null;
  const match = /^(?:(EUR|GBP|USD|[A-Z]{3}|€|£)\s*)?(\d+)(?:[.,](\d{1,3}))?\s*(EUR|GBP|USD|[A-Z]{3}|€|£)?(?:\s*(?:\/|per\s+)(person|group))?$/.exec(raw.trim());
  if (!match) return null;
  const before = symbols[match[1]] ?? match[1];
  const after = symbols[match[4]] ?? match[4];
  const currency = before ?? after ?? rawCurrency?.trim().toUpperCase();
  if (!currency || !currencies.has(currency) || (before && after && before !== after) || (rawCurrency && rawCurrency.trim().toUpperCase() !== currency)) return null;
  const fractionDigits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
  if (fractionDigits === undefined || (match[3]?.length ?? 0) > fractionDigits) return null;
  const amountMinor = Number(match[2]) * 10 ** fractionDigits + Number((match[3] ?? "").padEnd(fractionDigits, "0"));
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return null;
  return { amountMinor, currency, fractionDigits, priceType: "general", unit: match[5] === "person" ? "per_person" : match[5] === "group" ? "per_group" : "unknown" };
}
/** Future verified official enrichers can use this without losing stronger evidence. */
export function preferAdmission(existing: AttractionAdmission | null | undefined, incoming: AttractionAdmission): AttractionAdmission {
  if (existing?.source === "official" && existing.checkedAt && existing.status !== "unknown") return existing;
  if (incoming.source === "official" && incoming.checkedAt && incoming.status !== "unknown") return incoming;
  if (existing?.rawFeeConditional || existing?.rawChargeConditional) return { ...existing, status: "unknown", price: null };
  if (incoming.rawFeeConditional || incoming.rawChargeConditional) return { ...incoming, status: "unknown", price: null };
  if (existing?.notes?.startsWith("Conflicting")) return existing;
  if (!existing || existing.status === "unknown") return incoming;
  if (incoming.status === "unknown") return existing;
  if (existing.status !== incoming.status) return { ...existing, status: "unknown", price: null, notes: "Conflicting admission metadata across duplicate OSM features." };
  if (existing.price && incoming.price && JSON.stringify(existing.price) !== JSON.stringify(incoming.price)) return { ...existing, price: null, notes: "Conflicting prices across duplicate OSM features." };
  return existing.price ? existing : incoming;
}
export function normalizeAdmission(tags: Record<string, unknown>, retrievedAt = new Date().toISOString()): AttractionAdmission {
  const value = (key: string) => typeof tags[key] === "string" ? (tags[key] as string).slice(0, 10000) : null;
  const rawFee = value("fee"), rawCharge = value("charge");
  const result: AttractionAdmission = { status: "unknown", price: null, source: rawFee || rawCharge || value("fee:conditional") || value("charge:conditional") ? "osm" : null,
    sourceUrl: null, checkedAt: value("check_date:fee"), retrievedAt, rawFee, rawCharge,
    rawFeeConditional: value("fee:conditional"), rawChargeConditional: value("charge:conditional"), rawCurrency: value("currency"), menuUrl: value("website:menu"), notes: null };
  const url = value("website") ?? value("contact:website");
  if (url && /^https?:\/\//i.test(url) && url.length <= 2000) result.sourceUrl = url;
  // Restaurant charges, parking, rentals and transport fees are not admission.
  const supported = ["museum", "gallery", "zoo", "aquarium", "theme_park", "attraction"].includes(String(tags.tourism))
    || ["water_park", "park", "garden", "nature_reserve"].includes(String(tags.leisure))
    || ["castle", "ruins", "monument", "archaeological_site"].includes(String(tags.historic));
  if (!supported) { result.notes = "Feature semantics do not confirm an admission fee."; return result; }
  if (result.rawFeeConditional || result.rawChargeConditional) { result.notes = "Conditional pricing requires verification for the visit date."; return result; }
  const fee = rawFee?.trim().toLowerCase();
  const price = parseCharge(rawCharge, result.rawCurrency);
  if (fee === "no" && rawCharge && rawCharge.trim() !== "0") { result.notes = "Conflicting fee and charge tags."; return result; }
  if (fee === "no") result.status = "free";
  else if (fee === "yes") { result.status = "paid"; result.price = price; }
  else if (!fee && price) { result.status = "paid"; result.price = price; }
  if (rawCharge && !result.price && result.status !== "free") result.notes = "Exact admission price is unavailable or ambiguous.";
  return result;
}
