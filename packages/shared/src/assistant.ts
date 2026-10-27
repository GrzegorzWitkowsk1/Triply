import { supportedLocaleSchema } from "./locale.js";
import { z } from "zod";
import type { RegenerateDayPreview } from "./regeneration.js";
import type { ItineraryDay } from "./trip.js";

export const assistantMessageRequestSchema = z.object({
  locale: supportedLocaleSchema.optional(),
  message: z.string().trim().min(1).max(2000),
  conversationId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  selectedDayId: z.string().regex(/^\d{1,3}$/).optional(),
  candidate: z.object({ attractionId: z.string().trim().min(1).max(120), position: z.number().int().min(0).max(500) }).strict().optional(),
}).strict();
export type AssistantMessageRequest = z.infer<typeof assistantMessageRequestSchema>;
export interface AssistantMessage { id: string; role: "user" | "ai"; text: string }
export type AssistantResponse =
  | { type: "message"; message: string }
  | { type: "clarification"; message: string; picker?: { dayIndex: number; replace: boolean; stopCount: number } }
  | { type: "error"; message: string; retryable: boolean }
  | { type: "action_preview"; message: string; actionType: "regenerate_day"; preview: RegenerateDayPreview }
  | { type: "action_preview"; message: string; actionType: "expense"; previewId: string }
  | { type: "action_preview"; message: string; actionType: "edit_itinerary"; previewId: string; days: ItineraryDay[]; warnings: string[] };
export interface AssistantConversation { conversationId: string; messages: AssistantMessage[] }
export interface AssistantMessageResult extends AssistantConversation { response: AssistantResponse }
