import { attractionNameSchema, tripAttractionSchema, type CreationContext, type TripAttraction, type RequestedAttractionOutcome, type TripAnalysis, type TripItinerary } from "@triply/shared";
import { distanceMeters } from "./geo.js";
import { normalizeAttractionName } from "./attachmentContext.js";
import { lookupCreationAttractions } from "./attractions.js";

export interface NamedLookup { matches: { name: string; place: TripAttraction }[]; available: boolean; }
export async function resolveCreationAttractions(context: CreationContext, analysis: TripAnalysis, candidates: TripAttraction[], lookup = lookupCreationAttractions) {
  const location = analysis.location;
  if (!location) return { candidates, outcomes: [] as RequestedAttractionOutcome[] };
  const relevant = (p: TripAttraction) => tripAttractionSchema.safeParse(p).success && !!p.placeId && distanceMeters(location.lat, location.lng, p.lat, p.lng) <= 5000;
  const pool = candidates.filter(relevant);
  const excluded = new Set(context.excludedAttractions.map(normalizeAttractionName));
  const outcomes: RequestedAttractionOutcome[] = context.requestedAttractions.map(name => {
    const place = pool.find(p => normalizeAttractionName(p.name) === normalizeAttractionName(name));
    return { name, placeId: place?.placeId ?? null, status: excluded.has(normalizeAttractionName(name)) ? "excluded" : place ? "not_scheduled" : "unresolved",
      reason: excluded.has(normalizeAttractionName(name)) ? "user_excluded" : place ? "capacity" : "not_found" };
  });
  const missing = outcomes.filter(o => o.status === "unresolved").map(o => attractionNameSchema.parse(o.name));
  if (missing.length) {
    let found: NamedLookup;
    try { found = await lookup(location.lat, location.lng, missing); }
    catch { found = { matches: [], available: false }; }
    for (const outcome of outcomes.filter(o => o.status === "unresolved")) {
      const matches = found.matches.filter(m => normalizeAttractionName(m.name) === normalizeAttractionName(outcome.name) && relevant(m.place));
      // Ambiguous matches are not guessed. Different OSM objects at the same location are deduplicated.
      const unique = [...new Map(matches.map(m => [`${m.place.lat.toFixed(4)}:${m.place.lng.toFixed(4)}`, m.place])).values()];
      if (unique.length !== 1) { outcome.reason = found.available ? "not_found" : "provider_unavailable"; continue; }
      const place = unique[0];
      if (excluded.has(normalizeAttractionName(place.name))) { outcome.status = "excluded"; outcome.reason = "user_excluded"; continue; }
      const existing = pool.find(p => p.placeId === place.placeId || normalizeAttractionName(p.name) === normalizeAttractionName(place.name) && distanceMeters(p.lat, p.lng, place.lat, place.lng) < 50);
      if (!existing) pool.push(place);
      outcome.placeId = (existing ?? place).placeId!; outcome.status = "not_scheduled"; outcome.reason = "capacity";
    }
  }
  const requested = new Set(outcomes.filter(o => o.status === "not_scheduled").map(o => o.placeId));
  return { candidates: pool.filter(p => !excluded.has(normalizeAttractionName(p.name))).map(p => requested.has(p.placeId ?? null) ? { ...p, score: Math.min(100, (p.score ?? 50) + 30) } : p), outcomes };
}

/** Reserve a meaningful share of a bounded candidate pool for real requested places.
 * The ordinary planner still performs routing, opening-hours checks, and scheduling. */
export function prioritizeCreationCandidates(candidates: TripAttraction[], outcomes: RequestedAttractionOutcome[], days: number, pace: TripAnalysis["pace"]): TripAttraction[] {
  const target = Math.max(1, days * ({ relaxed: 3, balanced: 4, packed: 6 }[pace ?? "balanced"]));
  const ids = new Set(outcomes.filter(o => o.status === "not_scheduled").map(o => o.placeId));
  const requested = candidates.filter(p => ids.has(p.placeId ?? null)).slice(0, Math.max(1, Math.ceil(target * .6)));
  const chosen = new Set(requested.map(p => p.placeId));
  const others = candidates.filter(p => !ids.has(p.placeId ?? null)).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const remainingRequested = candidates.filter(p => ids.has(p.placeId ?? null) && !chosen.has(p.placeId));
  return [...requested, ...others, ...remainingRequested].slice(0, target);
}

export function finalizeCreationOutcomes(outcomes: RequestedAttractionOutcome[], itinerary: Pick<TripItinerary, "days" | "unscheduled">): RequestedAttractionOutcome[] {
  const included = new Set(itinerary.days.flatMap(d => d.activities.filter(a => a.type === "attraction" && a.schedulingStatus !== "unresolved" && !!a.startTime).map(a => a.placeId)));
  return outcomes.map(outcome => {
    if (outcome.status === "excluded" || !outcome.placeId) return outcome;
    if (included.has(outcome.placeId)) return { ...outcome, status: "included", reason: null };
    const failure = itinerary.unscheduled.find(p => p.place.placeId === outcome.placeId);
    return { ...outcome, status: failure?.reason === "opening-hours-conflict" ? "excluded" : "not_scheduled",
      reason: failure?.reason === "opening-hours-conflict" ? "constraints" : "capacity" };
  });
}
