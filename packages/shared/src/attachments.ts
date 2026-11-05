import { z } from "zod";
import { isIsoDate } from "./dates.js";

export const ATTACHMENT_LIMITS = {
  files: 3, pdfBytes: 5 * 1024 * 1024, txtBytes: 100 * 1024, totalBytes: 10 * 1024 * 1024,
  transportBytes: 11 * 1024 * 1024, metadataBytes: 16 * 1024, pages: 20,
  textCharacters: 10_000, totalTextCharacters: 20_000, requestedAttractions: 20,
  pdfTimeoutMs: 5_000, extractionTimeoutMs: 10_000, aiTimeoutMs: 30_000,
} as const;
export const ATTACHMENT_ACCEPT = ".txt,.pdf,text/plain,application/pdf";
export const ATTACHMENT_ERROR_CODES = [
  "ATTACHMENT_AUTH_REQUIRED", "ATTACHMENT_FORMAT", "ATTACHMENT_COUNT", "ATTACHMENT_SIZE",
  "ATTACHMENT_TOTAL_SIZE", "ATTACHMENT_EMPTY", "ATTACHMENT_DUPLICATE", "ATTACHMENT_ENCODING",
  "ATTACHMENT_INVALID_PDF", "ATTACHMENT_ENCRYPTED_PDF", "ATTACHMENT_SCANNED_PDF", "ATTACHMENT_PAGES",
  "ATTACHMENT_TEXT_LIMIT", "ATTACHMENT_TIMEOUT", "ATTACHMENT_FAILED", "ATTACHMENT_METADATA",
  "ATTACHMENT_BUSY", "ATTACHMENT_RATE_LIMIT", "ATTACHMENT_AI_FAILED",
  "ATTACHMENT_ATTRACTION_LIMIT",
] as const;
export type AttachmentErrorCode = typeof ATTACHMENT_ERROR_CODES[number];
export type AttachmentProcessingStatus = "selected" | "processing" | "failed";
export interface AttachmentFailure { index: number; code: AttachmentErrorCode; }

export const attractionNameSchema = z.string().trim().min(2).max(120)
  .refine(value => !/[\u0000-\u001f\u007f<>]/u.test(value) && !/https?:|www\./iu.test(value));
const names = z.array(attractionNameSchema).max(ATTACHMENT_LIMITS.requestedAttractions);
const date = z.string().refine(isIsoDate).nullable();
export const supplementalRequirementsSchema = z.strictObject({
  destination: z.string().trim().min(1).max(120).nullable(),
  country: z.string().trim().min(1).max(120).nullable(),
  startDate: date, endDate: date,
  durationDays: z.number().int().min(1).max(365).nullable(),
  travelers: z.number().int().min(1).max(50).nullable(),
  budget: z.strictObject({ amount: z.number().min(0).max(1_000_000_000).nullable(), currency: z.string().regex(/^[A-Z]{3}$/).nullable(), type: z.enum(["total", "per_person"]).nullable() }),
  interests: z.array(z.enum(["food", "architecture", "beach", "nature", "culture", "shopping", "nightlife"])).max(7),
  pace: z.enum(["relaxed", "balanced", "packed"]).nullable(),
  maxWalkingDistanceKm: z.number().min(0).max(100).nullable(),
  requestedAttractions: names, excludedAttractions: names,
});
export type SupplementalRequirements = z.infer<typeof supplementalRequirementsSchema>;
export const attractionOutcomeSchema = z.strictObject({
  name: attractionNameSchema, placeId: z.string().max(120).nullable(),
  status: z.enum(["included", "not_scheduled", "unresolved", "excluded"]),
  reason: z.enum(["not_found", "provider_unavailable", "capacity", "constraints", "user_excluded"]).nullable(),
});
export type RequestedAttractionOutcome = z.infer<typeof attractionOutcomeSchema>;
export const creationContextSchema = z.strictObject({
  requestedAttractions: names, excludedAttractions: names,
  // Only values that were actually adopted; no raw text, filenames, or model prose.
  adopted: supplementalRequirementsSchema,
});
export type CreationContext = z.infer<typeof creationContextSchema>;

/** Advisory browser validation; the server also verifies bytes and parser results. */
export function validateAttachmentFile(file: { name: string; type: string; size: number }): AttachmentErrorCode | null {
  const extension = file.name.toLowerCase().split(".").pop();
  const mime = file.type.toLowerCase();
  if (extension !== "txt" && extension !== "pdf") return "ATTACHMENT_FORMAT";
  // Empty/octet-stream MIME is common in native pickers; bytes remain authoritative.
  if (mime && mime !== "application/octet-stream" && mime !== (extension === "pdf" ? "application/pdf" : "text/plain")) return "ATTACHMENT_FORMAT";
  if (!file.size) return "ATTACHMENT_EMPTY";
  if (file.size > (extension === "pdf" ? ATTACHMENT_LIMITS.pdfBytes : ATTACHMENT_LIMITS.txtBytes)) return "ATTACHMENT_SIZE";
  return null;
}
