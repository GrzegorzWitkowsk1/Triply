import { z } from "zod";
import { INTEREST_OPTIONS } from "./trip.js";

export const DESTINATION_SORTS = ["name-asc", "name-desc", "country-asc"] as const;
export function normalizeDestinationText(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/ł/g, "l").replace(/ø/g, "o").replace(/æ/g, "ae").replace(/œ/g, "oe").replace(/ß/g, "ss")
    .trim().replace(/\s+/gu, " ");
}
const interestId = z.string().refine(value => INTEREST_OPTIONS.some(option => option.id === value), "Unknown interest");

const text = z.string().max(4000).catch("").default("");
const publicUrl = z.url({ protocol: /^https$/, normalize: true }).max(4096).refine(value => !/^https:\/\/[^/]*@/i.test(value)).catch("").default("");
const attributionUrl = z.url({ protocol: /^https?$/, normalize: true }).max(4096).refine(value => !/^https?:\/\/[^/]*@/i.test(value)).catch("").default("");
/** Allowlist for public catalog responses. Missing optional metadata stays unknown. */
export const catalogDestinationSchema = z.object({
  id: z.string().regex(/^city-\d{3}$/), city: z.string().trim().min(1).max(120),
  country: z.string().trim().max(120).catch("").default(""),
  imageUrl: publicUrl, photographer: text, license: text, licenseUrl: attributionUrl,
  sourceUrl: attributionUrl, source: text, status: text, licenseAuditStatus: text,
  licenseAuditReason: text, attributionRequired: z.boolean().catch(true).default(true), attributionText: text,
  region: z.string().trim().min(1).max(120).optional().catch(undefined),
  aliases: z.array(z.string().trim().min(1).max(120)).max(20).optional().catch(undefined),
  interests: z.array(interestId).max(INTEREST_OPTIONS.length).optional().catch(undefined),
});
export const destinationPaginationSchema = z.object({
  page: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(1_000_000)).default(1),
  pageSize: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(48)).default(24),
}).strict();
export const destinationQuerySchema = destinationPaginationSchema.extend({
  q: z.string().max(120).transform(value => value.trim().replace(/\s+/gu, " ")).default(""),
  country: z.string().max(120).transform(normalizeDestinationText).default(""),
  region: z.string().max(250).transform(normalizeDestinationText).default(""),
  interests: z.string().max(200).transform(value => [...new Set(value.split(",").filter(Boolean))].sort())
    .pipe(z.array(interestId).max(INTEREST_OPTIONS.length)).default([]),
  sort: z.enum(DESTINATION_SORTS).catch("name-asc").default("name-asc"),
}).superRefine((value, context) => {
  if (value.region && !value.country) context.addIssue({ code: "custom", path: ["region"], message: "Region requires a country" });
});
export type DestinationQuery = z.infer<typeof destinationQuerySchema>;
const filterOption = z.object({ id: z.string().min(1).max(250), name: z.string().trim().min(1).max(120), count: z.number().int().positive() });
export const destinationFiltersSchema = z.object({
  total: z.number().int().nonnegative(),
  countries: z.array(filterOption.extend({ id: z.string().min(1).max(120) })),
  regions: z.array(filterOption.extend({ countryId: z.string() })),
  interests: z.array(z.object({ id: interestId, label: z.string(), count: z.number().int().positive() })),
});
export type DestinationFilters = z.infer<typeof destinationFiltersSchema>;
export const destinationListSchema = z.object({
  items: z.array(catalogDestinationSchema), total: z.number().int().nonnegative(),
  page: z.number().int().positive(), pageSize: z.number().int().positive().max(48),
});
export type DestinationList = z.infer<typeof destinationListSchema>;
