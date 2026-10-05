import { model, Schema, type HydratedDocument, type Types } from "mongoose";
import type { AskableField, TripAnalysis } from "@triply/shared";

export interface TripRecord {
  user: Types.ObjectId;
  status: "draft" | "confirmed";
  prompt: string;
  badges: string[];
  analysis: TripAnalysis;
  confirmedFields: AskableField[];
  missingFields: AskableField[];
}

export type TripDocument = HydratedDocument<TripRecord>;

const budgetSchema = new Schema<TripAnalysis["budget"]>(
  {
    amount: { type: Number, default: null },
    currency: { type: String, default: null, trim: true },
    type: { type: String, enum: ["total", "per_person", null], default: null },
  },
  { _id: false },
);

const analysisSchema = new Schema<TripAnalysis>(
  {
    destination: { type: String, default: null, trim: true },
    country: { type: String, default: null, trim: true },
    startDate: { type: String, default: null, trim: true },
    endDate: { type: String, default: null, trim: true },
    durationDays: { type: Number, default: null },
    travelers: { type: Number, default: null },
    budget: { type: budgetSchema, default: () => ({ amount: null, currency: null, type: null }) },
    interests: { type: [String], default: [] },
    pace: { type: String, enum: ["relaxed", "balanced", "packed", null], default: null },
    maxWalkingDistanceKm: { type: Number, default: null },
    notes: { type: String, default: null, trim: true },
  },
  { _id: false },
);

const tripSchema = new Schema<TripRecord>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["draft", "confirmed"],
      default: "draft",
    },
    prompt: { type: String, default: "", trim: true },
    badges: { type: [String], default: [] },
    analysis: { type: analysisSchema, required: true },
    confirmedFields: { type: [String], default: [] },
    missingFields: { type: [String], default: [] },
  },
  { timestamps: true },
);

tripSchema.index({ user: 1, status: 1 });

export const TripModel = model<TripRecord>("Trip", tripSchema);