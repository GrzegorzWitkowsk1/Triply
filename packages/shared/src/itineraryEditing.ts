import { z } from "zod";
import type { TripAttraction, TripDetail, TripUnscheduledPlace } from "./trip.js";

const id = z.string().trim().min(1).max(120);
const dayIndex = z.number().int().positive().max(365);
const position = z.number().int().nonnegative().max(500).optional();

export const itineraryEditOperationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("reroute"), dayIndex }).strict(),
  z.object({ type: z.literal("add"), dayIndex, attractionId: id, position }).strict(),
  z.object({ type: z.literal("remove"), dayIndex, attractionId: id }).strict(),
  z.object({ type: z.literal("reorder"), dayIndex, attractionIds: z.array(id).max(500) }).strict(),
  z.object({ type: z.literal("move"), sourceDayIndex: dayIndex, targetDayIndex: dayIndex, attractionId: id, position }).strict(),
  z.object({ type: z.literal("replace"), dayIndex, oldAttractionId: id, newAttractionId: id }).strict(),
]);
export type ItineraryEditOperation = z.infer<typeof itineraryEditOperationSchema>;
export const itineraryEditRequestSchema = z.object({
  operation: itineraryEditOperationSchema,
  expectedVersion: z.number().int().nonnegative(),
}).strict();
export type ItineraryEditRequest = z.infer<typeof itineraryEditRequestSchema>;
export interface ItineraryEditResponse {
  trip: TripDetail;
  itineraryVersion: number;
  affectedDayIndices: number[];
  warnings: string[];
}
export interface ItineraryEditConflict {
  error: string;
  warnings: string[];
  conflicts: TripUnscheduledPlace[];
}
export const itineraryCandidatesRequestSchema = z.object({
  search: z.string().trim().max(120).default(""),
  discover: z.boolean().default(false),
}).strict();
export interface ItineraryCandidate extends TripAttraction {
  placeId: string;
  scheduledDayIndex: number | null;
}
export interface ItineraryCandidatesResponse {
  candidates: ItineraryCandidate[];
  warnings: string[];
}
