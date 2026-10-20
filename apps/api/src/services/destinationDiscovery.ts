import { INTEREST_OPTIONS, destinationFiltersSchema, normalizeDestinationText, type DestinationQuery } from "@triply/shared";
import type { FilterQuery } from "mongoose";
import { DestinationModel, type CatalogRecord } from "../models/Destination.js";

/** Exclude unusable identities/names before counting and paging, without deleting Saved references. */
export const catalogVisibilityFilter: FilterQuery<CatalogRecord> = {
  $expr: { $and: [
    { $eq: [{ $type: "$id" }, "string"] },
    { $regexMatch: { input: { $cond: [{ $eq: [{ $type: "$id" }, "string"] }, "$id", ""] }, regex: /^city-\d{3}$/ } },
    { $gt: [{ $strLenCP: { $trim: { input: { $cond: [{ $eq: [{ $type: "$city" }, "string"] }, "$city", ""] } } } }, 0] },
    { $lte: [{ $strLenCP: { $cond: [{ $eq: [{ $type: "$city" }, "string"] }, "$city", ""] } }, 120] },
  ] },
};

export function discoveryFilter(query: DestinationQuery): FilterQuery<CatalogRecord> {
  const filter: FilterQuery<CatalogRecord> = { ...catalogVisibilityFilter };
  if (query.country) filter.countryKey = query.country;
  if (query.region) filter.regionKey = query.region;
  if (query.interests.length) filter.interests = { $type: "array", $in: query.interests };
  const words = normalizeDestinationText(query.q).split(" ").filter(Boolean);
  if (words.length) filter.$and = words.map(word => ({ searchText: { $regex: word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") } }));
  return filter;
}
export function discoverySort(sort: DestinationQuery["sort"]): Record<string, 1 | -1> {
  if (sort === "name-desc") return { nameSort: -1, id: 1 };
  if (sort === "country-asc") return { countrySort: 1, nameSort: 1, id: 1 };
  return { nameSort: 1, id: 1 };
}
/** Global catalog counts, independent of active filters; fetched separately from typing. */
export async function destinationFilters() {
  const [result] = await DestinationModel.aggregate([{
    $match: catalogVisibilityFilter,
  }, { $facet: {
    total: [{ $count: "count" }],
    countries: [{ $match: { $expr: { $and: [
      { $eq: [{ $type: "$countryKey" }, "string"] }, { $ne: ["$countryKey", ""] },
      { $eq: [{ $type: "$country" }, "string"] },
    ] } } },
      { $group: { _id: "$countryKey", name: { $min: "$country" }, count: { $sum: 1 } } }, { $sort: { _id: 1 } },
      { $project: { _id: 0, id: "$_id", name: 1, count: 1 } }],
    regions: [{ $match: { $expr: { $and: [
      { $eq: [{ $type: "$regionKey" }, "string"] }, { $ne: ["$regionKey", ""] },
      { $eq: [{ $type: "$region" }, "string"] }, { $eq: [{ $type: "$countryKey" }, "string"] },
    ] } } },
      { $group: { _id: "$regionKey", countryId: { $first: "$countryKey" }, name: { $min: "$region" }, count: { $sum: 1 } } }, { $sort: { _id: 1 } },
      { $project: { _id: 0, id: "$_id", name: 1, countryId: 1, count: 1 } }],
    interests: [{ $match: { $expr: { $eq: [{ $type: "$interests" }, "array"] } } }, { $unwind: "$interests" }, { $group: { _id: { id: "$id", interest: "$interests" } } },
      { $group: { _id: "$_id.interest", count: { $sum: 1 } } }],
  } }]).option({ maxTimeMS: 3000 }).exec();
  return destinationFiltersSchema.parse({ total: result?.total[0]?.count ?? 0,
    countries: (result?.countries ?? []).flatMap((row: unknown) => {
      const parsed = destinationFiltersSchema.shape.countries.element.safeParse(row); return parsed.success ? [parsed.data] : [];
    }), regions: (result?.regions ?? []).flatMap((row: unknown) => {
      const parsed = destinationFiltersSchema.shape.regions.element.safeParse(row); return parsed.success ? [parsed.data] : [];
    }),
    interests: INTEREST_OPTIONS.flatMap(option => {
      const row = result?.interests.find((item: { _id: string }) => item._id === option.id);
      return row ? [{ ...option, count: row.count }] : [];
    }),
  });
}
