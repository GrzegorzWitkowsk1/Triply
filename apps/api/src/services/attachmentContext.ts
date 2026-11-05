import { deriveTripSchedule, supplementalRequirementsSchema, tripAnalysisSchema, creationContextSchema,
  type TripAnalysis, type SupplementalRequirements, type CreationContext, type AnalyzeTripRequest } from "@triply/shared";
import { AttachmentError } from "./attachmentExtraction.js";

export function normalizeAttractionName(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
export function mergeAttachmentContext(baseline: TripAnalysis, direct: { requestedAttractions: string[]; excludedAttractions: string[]; protectedFields?: string[] },
  suggestions: SupplementalRequirements, input: AnalyzeTripRequest): { analysis: TripAnalysis; context: CreationContext } {
  const next = structuredClone(baseline);
  const protectedFields = new Set(direct.protectedFields);
  const adopted = supplementalRequirementsSchema.parse({ ...suggestions, destination: null, country: null, startDate: null, endDate: null,
    durationDays: null, travelers: null, budget: { amount: null, currency: null, type: null }, interests: [], pace: null,
    maxWalkingDistanceKm: null, requestedAttractions: [], excludedAttractions: [] });
  // Destination and dates are atomic groups: never mix Rome/France or three days/seven-day dates.
  if (!protectedFields.has("destination") && !input.destinationId && !baseline.destination && !baseline.country) {
    next.destination = adopted.destination = suggestions.destination;
    next.country = adopted.country = suggestions.country;
  }
  if (!protectedFields.has("dates") && !baseline.startDate && !baseline.endDate && !baseline.durationDays) {
    next.startDate = adopted.startDate = suggestions.startDate;
    next.endDate = adopted.endDate = suggestions.endDate;
    next.durationDays = adopted.durationDays = suggestions.durationDays;
  }
  if (!protectedFields.has("travelers") && baseline.travelers === null) next.travelers = adopted.travelers = suggestions.travelers;
  if (!protectedFields.has("budget") && baseline.budget.amount === null && baseline.budget.currency === null && baseline.budget.type === null) next.budget = adopted.budget = suggestions.budget;
  // Conservative fill-only semantics also preserve direct negative/category preferences.
  if (!protectedFields.has("interests") && !baseline.interests.length && !input.badges.length && input.interests === undefined) next.interests = adopted.interests = suggestions.interests;
  if (input.pace !== undefined) next.pace = input.pace;
  else if (!protectedFields.has("pace") && baseline.pace === null) next.pace = adopted.pace = suggestions.pace;
  if (input.maxWalkingDistanceKm !== undefined) next.maxWalkingDistanceKm = input.maxWalkingDistanceKm;
  else if (!protectedFields.has("maxWalkingDistanceKm") && baseline.maxWalkingDistanceKm === null) next.maxWalkingDistanceKm = adopted.maxWalkingDistanceKm = suggestions.maxWalkingDistanceKm;
  if (input.interests !== undefined) next.interests = input.interests;
  const unique = (names: string[]) => [...new Map(names.map(name => [normalizeAttractionName(name), name])).values()];
  // Documents cannot exclude anything the direct request asks for, or add application instructions.
  const requestedAttractions = unique([...direct.requestedAttractions, ...suggestions.requestedAttractions]);
  const directNames = new Set(direct.requestedAttractions.map(normalizeAttractionName));
  const excludedAttractions = unique([...direct.excludedAttractions, ...suggestions.excludedAttractions.filter(name => !directNames.has(normalizeAttractionName(name)))]);
  if (requestedAttractions.length > 20 || excludedAttractions.length > 20) throw new AttachmentError("ATTACHMENT_ATTRACTION_LIMIT", 422);
  adopted.requestedAttractions = suggestions.requestedAttractions.filter(name => !excludedAttractions.some(excluded => normalizeAttractionName(name) === normalizeAttractionName(excluded)));
  adopted.excludedAttractions = suggestions.excludedAttractions.filter(name => !directNames.has(normalizeAttractionName(name)));
  return { analysis: tripAnalysisSchema.parse(deriveTripSchedule(next)), context: creationContextSchema.parse({ requestedAttractions, excludedAttractions, adopted }) };
}
