import { supportedLocaleSchema } from "./locale.js";
import { z } from "zod";
import type { RegenerateDayPreview } from "./regeneration.js";
import type { ItineraryDay } from "./trip.js";

export const assistantMessageRequestSchema = z.object({
  requestId: z.string().uuid().optional(),
  retryMessageId: z.string().uuid().optional(),
  timeZone: z.string().max(100).refine(value => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }).optional(),
  locale: supportedLocaleSchema.optional(),
  message: z.string().trim().min(1).max(2000),
  conversationId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  selectedDayId: z.string().regex(/^\d{1,3}$/).optional(),
  candidate: z.object({ attractionId: z.string().trim().min(1).max(120), position: z.number().int().min(0).max(500) }).strict().optional(),
}).strict();
export type AssistantMessageRequest = z.infer<typeof assistantMessageRequestSchema>;
export type AssistantErrorCode = "RATE_LIMITED" | "PROVIDER_TIMEOUT" | "PROVIDER_UNAVAILABLE" | "PROVIDER_BAD_RESPONSE" | "CONTEXT_TOO_LARGE" | "INTERNAL_ERROR";
export interface AssistantMessage { id: string; role: "user" | "ai"; text: string; failed?: boolean; proposalId?: string }
export type AssistantResponse =
  | { type: "action_proposal"; message: string; proposal: import("./assistantActions.js").AssistantActionProposal }
  | { type: "message"; message: string }
  | { type: "clarification"; message: string; picker?: { dayIndex: number; replace: boolean; stopCount: number } }
  | { type: "error"; message: string; retryable: boolean; code?: AssistantErrorCode }
  | { type: "action_preview"; message: string; actionType: "regenerate_day"; preview: RegenerateDayPreview }
  | { type: "action_preview"; message: string; actionType: "expense"; previewId: string }
  | { type: "action_preview"; message: string; actionType: "edit_itinerary"; previewId: string; days: ItineraryDay[]; warnings: string[] };
export interface AssistantConversation { conversationId: string; messages: AssistantMessage[]; proposals?: import("./assistantActions.js").AssistantActionProposal[] }
export interface AssistantMessageResult extends AssistantConversation { tripId: string; requestId?: string; response: AssistantResponse }
