import { model, Schema } from "mongoose";

export interface ApiUsageRecord {
  provider: "geoapify";
  service: "places";
  date: string;
  reservedCredits: number;
  consumedCredits: number;
  requests: number;
  reservations: { id: string; credits: number }[];
  updatedAt: Date;
}

const schema = new Schema<ApiUsageRecord>({
  provider: { type: String, required: true, enum: ["geoapify"] },
  service: { type: String, required: true, enum: ["places"] },
  date: { type: String, required: true },
  reservedCredits: { type: Number, required: true, min: 0, default: 0 },
  consumedCredits: { type: Number, required: true, min: 0, default: 0 },
  requests: { type: Number, required: true, default: 0 },
  reservations: [{ _id: false, id: { type: String, required: true }, credits: { type: Number, required: true } }],
  updatedAt: { type: Date, required: true },
}, { collection: "apiUsage", bufferCommands: false });
schema.index({ provider: 1, service: 1, date: 1 }, { unique: true });
export const ApiUsageModel = model<ApiUsageRecord>("ApiUsage", schema);
