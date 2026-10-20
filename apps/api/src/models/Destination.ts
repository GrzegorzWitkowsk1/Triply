import mongoose, { Schema } from "mongoose";
import { normalizeDestinationText, type Destination, type DestinationList } from "@triply/shared";

export type CatalogRecord = Destination & Pick<DestinationList["items"][number], "region" | "aliases" | "interests"> & {
  searchText?: string; nameSort?: string; countrySort?: string; countryKey?: string; regionKey?: string;
};
export function destinationSearchFields(place: Pick<CatalogRecord, "city" | "country" | "region" | "aliases">) {
  const safeText = (value: unknown) => typeof value === "string" ? normalizeDestinationText(value) : "";
  const countryKey = safeText(place.country);
  return {
    nameSort: safeText(place.city), countrySort: countryKey, countryKey,
    regionKey: safeText(place.region) && countryKey ? `${countryKey}:${safeText(place.region)}` : "",
    searchText: [place.city, place.country, place.region, ...(Array.isArray(place.aliases) ? place.aliases : [])].map(safeText).filter(Boolean).join(" "),
  };
}

const schema = new Schema<CatalogRecord>({
  id: { type: String, required: true, unique: true },
  city: { type: String, required: true }, country: String,
  imageUrl: String, photographer: String, license: String, licenseUrl: String,
  sourceUrl: String, source: String, status: String, licenseAuditStatus: String,
  licenseAuditReason: String, attributionRequired: Boolean, attributionText: String,
  region: String, aliases: { type: [String], default: undefined }, interests: { type: [String], default: undefined },
  searchText: String, nameSort: String, countrySort: String, countryKey: String, regionKey: String,
}, { versionKey: false });
schema.index({ nameSort: 1, id: 1 });
schema.index({ nameSort: -1, id: 1 });
schema.index({ countrySort: 1, nameSort: 1, id: 1 });
schema.index({ countryKey: 1, nameSort: 1, id: 1 });
schema.index({ regionKey: 1, nameSort: 1, id: 1 });
schema.index({ interests: 1 });
schema.pre("validate", function () { Object.assign(this, destinationSearchFields(this)); });
export const DestinationModel = mongoose.model<CatalogRecord>("Destination", schema);
