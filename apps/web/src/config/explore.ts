import i18n from "../i18n";
import { findCuratedCollection } from "@triply/shared";
import { AccountBalanceOutlined, PaletteOutlined, RestaurantOutlined, WavesOutlined } from "@mui/icons-material";
import { CURATED_COLLECTIONS } from "@triply/shared";

export const COLLECTION_ICONS = { food: RestaurantOutlined, architecture: AccountBalanceOutlined, coastal: WavesOutlined, culture: PaletteOutlined };
export const COLLECTIONS = CURATED_COLLECTIONS.map(collection => ({ ...collection, get title() { return i18n.t(`${collection.slug}Title`, { ns: "explore/collections" }); }, get description() { return i18n.t(`${collection.slug}Description`, { ns: "explore/collections" }); }, icon: COLLECTION_ICONS[collection.icon] }));
export function localizedCollection(slug: unknown) {
  const collection = findCuratedCollection(slug);
  return collection ? { ...collection, get title() { return i18n.t(`${collection.slug}Title`, { ns: "explore/collections" }); }, get description() { return i18n.t(`${collection.slug}Description`, { ns: "explore/collections" }); } } : undefined;
}
