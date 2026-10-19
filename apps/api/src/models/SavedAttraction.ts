import { Schema, model } from "mongoose";
import type { SavedAttractionSnapshot } from "@triply/shared";

const snapshotSchema = new Schema<SavedAttractionSnapshot>({
  name: { type: String, required: true, maxlength: 200 },
  destinationName: { type: String, maxlength: 120 }, country: { type: String, maxlength: 120 },
  coordinates: { type: new Schema({ lat: { type: Number, required: true, min: -90, max: 90 }, lng: { type: Number, required: true, min: -180, max: 180 } }, { _id: false }), required: true },
  category: { type: String, required: true, maxlength: 60 },
  address: { type: String, maxlength: 1000 }, description: { type: String, maxlength: 2000 }, image: { type: String, maxlength: 2000 },
}, { _id: false });
const schema = new Schema({
  ownerType: { type: String, enum: ["user", "guest"], required: true, immutable: true },
  ownerId: { type: String, required: true, immutable: true },
  attractionKey: { type: String, required: true, immutable: true },
  provider: { type: String, enum: ["overpass", "geoapify", "unknown"], required: true },
  providerPlaceId: { type: String, maxlength: 2000 },
  snapshot: { type: snapshotSchema, required: true },
  createdAt: { type: Date, default: Date.now, immutable: true },
}, { versionKey: false });
schema.index({ ownerType: 1, ownerId: 1, attractionKey: 1 }, { unique: true });
schema.index({ ownerType: 1, ownerId: 1, createdAt: -1 });
export const SavedAttractionModel = model("SavedAttraction", schema);
