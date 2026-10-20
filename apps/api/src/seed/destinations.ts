import { DESTINATIONS, catalogDestinationSchema } from "@triply/shared";
import { DestinationModel, destinationSearchFields } from "../models/Destination.js";

/** Seed existing stable identities without deleting records or replacing curated fields. */
export async function seedDestinations(records: readonly unknown[] = DESTINATIONS): Promise<void> {
  const seen = new Set<string>();
  const places = records.map(record => {
    const place = catalogDestinationSchema.parse(record);
    if (seen.has(place.id)) throw new Error(`[destination seed] Duplicate ID: ${place.id}`);
    seen.add(place.id);
    return place;
  });
  await DestinationModel.createIndexes();
  if (places.length) await DestinationModel.bulkWrite(places.map(place => ({ updateOne: {
    filter: { id: place.id }, update: { $setOnInsert: place }, upsert: true,
  } })), { ordered: true });
  // Rebuild only derived discovery fields from persisted, possibly curated metadata.
  const stored = await DestinationModel.find({}).select("id city country region aliases searchText nameSort countrySort countryKey regionKey").lean().exec();
  const updates = stored.flatMap(place => {
    if (!catalogDestinationSchema.safeParse(place).success) console.warn(`[destination seed] Invalid catalog identity/name: ${/^city-\d{3}$/.test(place.id) ? place.id : "[invalid ID]"}; repair the record.`);
    const fields = destinationSearchFields(place);
    return Object.entries(fields).some(([key, value]) => place[key as keyof typeof fields] !== value) ? [{ updateOne: {
      filter: { _id: place._id }, update: { $set: fields },
    } }] : [];
  });
  if (updates.length) await DestinationModel.bulkWrite(updates);
}
