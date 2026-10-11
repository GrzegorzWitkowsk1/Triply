import { model, Schema, type Types } from "mongoose";
import type { AssistantMessage, ItineraryDay, ItineraryEditRequest } from "@triply/shared";
import type { AssistantIntent } from "../services/assistantIntent.js";

interface ConversationRecord {
  tripId: Types.ObjectId;
  userId: Types.ObjectId;
  messages: AssistantMessage[];
  lastDay: number | null;
  lastAttraction: string | null;
  pending: AssistantIntent | null;
  prepared: { id: string; expiresAt: Date; request: ItineraryEditRequest; days: ItineraryDay[]; warnings: string[] } | null;
  revision: number;
}
const schema = new Schema<ConversationRecord>({
  tripId: { type: Schema.Types.ObjectId, required: true },
  userId: { type: Schema.Types.ObjectId, required: true },
  messages: { type: [{ id: String, role: { type: String, enum: ["user", "ai"] }, text: String }], default: [] },
  lastDay: { type: Number, default: null },
  lastAttraction: { type: String, default: null },
  pending: { type: Schema.Types.Mixed, default: null },
  prepared: { type: Schema.Types.Mixed, default: null },
  revision: { type: Number, default: 0 },
}, { timestamps: true });
schema.index({ tripId: 1, userId: 1 }, { unique: true });
export const TripAssistantConversationModel = model<ConversationRecord>("TripAssistantConversation", schema);
