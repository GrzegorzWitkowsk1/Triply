import { AccountBalanceOutlined, PaletteOutlined, RestaurantOutlined, WavesOutlined } from "@mui/icons-material";
import { CURATED_COLLECTIONS } from "@triply/shared";

export const COLLECTION_ICONS = { food: RestaurantOutlined, architecture: AccountBalanceOutlined, coastal: WavesOutlined, culture: PaletteOutlined };
export const COLLECTIONS = CURATED_COLLECTIONS.map(collection => ({ ...collection, icon: COLLECTION_ICONS[collection.icon] }));