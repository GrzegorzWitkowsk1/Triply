import { z } from "zod";
import { equipmentCategorySchema, tripEquipmentItemSchema } from "./trip.js";

export const PACKING_SUGGESTION_LIMIT = 30;
export const packingSuggestionInputSchema = z.object({
  name: tripEquipmentItemSchema.shape.name,
  category: equipmentCategorySchema,
  count: z.number().int().min(1).max(60),
  reason: z.string().trim().min(1).max(240),
});
export const packingSuggestionSchema = packingSuggestionInputSchema.extend({ id: z.uuid() });
export const packingPreviewSchema = z.object({
  token: z.string().min(1).max(60000),
  suggestions: z.array(packingSuggestionSchema).max(PACKING_SUGGESTION_LIMIT),
  warnings: z.array(z.string().max(240)).max(10),
  generatedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  contextVersion: z.string().max(64),
});
export const applyPackingSuggestionsSchema = z.object({
  token: z.string().min(1).max(60000),
  selectedIds: z.array(z.uuid()).min(1).max(PACKING_SUGGESTION_LIMIT),
  allowStale: z.boolean().optional(),
}).strict();
export interface PackingApplyResult {
  added: import("./trip.js").TripEquipmentItem[];
  skipped: string[];
  stale: boolean;
}
export type PackingSuggestion = z.infer<typeof packingSuggestionSchema>;
export type PackingPreview = z.infer<typeof packingPreviewSchema>;
export type ApplyPackingSuggestions = z.infer<typeof applyPackingSuggestionsSchema>;

/** Exact canonical identity, deliberately without fuzzy or semantic matching. */
export function canonicalPackingName(name: string): string {
  return name.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{Z}\s]+/gu, " ").trim();
}

export const packingGenerationMetadataSchema = z.object({
  generatedAt: z.iso.datetime(),
  contextFingerprint: z.string().length(64),
  suggestionCount: z.number().int().min(0).max(PACKING_SUGGESTION_LIMIT),
});
export type PackingGenerationMetadata = z.infer<typeof packingGenerationMetadataSchema>;
export const packingContextStatusSchema = z.object({
  contextFingerprint: z.string().length(64),
  generation: packingGenerationMetadataSchema.nullable(),
  outdated: z.boolean(),
});
export type PackingContextStatus = z.infer<typeof packingContextStatusSchema>;
export const bulkPackingSchema = z.object({
  itemIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).min(1).max(100)
    .refine(ids => new Set(ids.map(id => id.toLowerCase())).size === ids.length, "Select each item only once"),
  packed: z.boolean(),
}).strict();
export type BulkPackingInput = z.infer<typeof bulkPackingSchema>;
export interface BulkPackingResult { equipment: import("./trip.js").TripEquipmentItem[]; updatedCount: number }

// Curated, category-specific synonyms flag uncertainty; they never authorize merging.
const PACKING_SYNONYMS = [
  { category: "clothing", names: ["rain jacket", "waterproof jacket"] },
  { category: "clothing", names: ["walking shoes", "comfortable walking shoes"] },
  { category: "electronics", names: ["phone charger", "mobile phone charger"] },
] as const;
export function matchPackingSuggestion(
  suggestion: { name: string; category: string },
  existing: readonly import("./trip.js").TripEquipmentItem[],
): { kind: "new" | "exact" | "possible"; matches: import("./trip.js").TripEquipmentItem[] } {
  const key = canonicalPackingName(suggestion.name);
  const exact = existing.filter(item => canonicalPackingName(item.name) === key);
  if (exact.length) return { kind: "exact", matches: exact };
  const synonyms = PACKING_SYNONYMS.find(group => group.category === suggestion.category && group.names.some(name => name === key));
  const matches = synonyms ? existing.filter(item => item.category === suggestion.category && synonyms.names.some(name => name === canonicalPackingName(item.name))) : [];
  return { kind: matches.length ? "possible" : "new", matches };
}
