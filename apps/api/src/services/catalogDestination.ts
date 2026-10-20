import { catalogDestinationSchema } from "@triply/shared";
import { DestinationModel } from "../models/Destination.js";

/** Resolve creation selections from the same persisted catalog served by Explore. */
export async function resolveCatalogDestination(id: string) {
  const record = await DestinationModel.findOne({ id }).maxTimeMS(3000).lean().exec();
  const destination = catalogDestinationSchema.safeParse(record);
  return destination.success && destination.data.country ? destination.data : null;
}
