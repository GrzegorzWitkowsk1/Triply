import { Schema, model } from "mongoose";

const schema = new Schema({
  ownerType: { type: String, enum: ["user", "guest"], required: true, immutable: true },
  ownerId: { type: String, required: true, immutable: true },
  destinationId: { type: String, required: true, immutable: true },
  createdAt: { type: Date, default: Date.now, immutable: true },
}, { versionKey: false });
schema.index({ ownerType: 1, ownerId: 1, destinationId: 1 }, { unique: true });
schema.index({ ownerType: 1, ownerId: 1, createdAt: -1 });
export const SavedDestinationModel = model("SavedDestination", schema);
