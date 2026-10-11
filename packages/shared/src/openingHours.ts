import { z } from "zod";

export const attractionOpeningHoursSchema = z.object({
  raw: z.string().max(10000).nullable(),
  source: z.enum(["osm", "official"]).nullable(),
  checkedAt: z.string().max(120).nullable(),
  legacyCovid19: z.string().max(10000).nullish(),
  website: z.string().max(2000).nullish(),
});
export type AttractionOpeningHours = z.infer<typeof attractionOpeningHoursSchema>;

/** A date-specific calculation, never a permanent property of a POI. */
export interface OpeningHoursCheck {
  status: "open" | "closed" | "unknown";
  reason: string;
  source: AttractionOpeningHours["source"];
  timeZone: string | null;
  intervals: { start: string; end: string; unknown: boolean }[];
  nextAvailableStart?: string;
  warnings: string[];
}
