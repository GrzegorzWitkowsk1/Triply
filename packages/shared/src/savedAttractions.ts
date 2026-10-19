import { z } from "zod";

export const attractionKeySchema = z.string().max(100).regex(/^(?:osm:(?:node|way|relation):\d+|(?:geoapify|fallback):[a-f0-9]{64})$/);
export const saveAttractionSchema = z.object({
  tripId: z.string().regex(/^[a-f0-9]{24}$/i),
  attractionKey: attractionKeySchema,
}).strict();
export type SaveAttractionRequest = z.infer<typeof saveAttractionSchema>;
export const savedAttractionSnapshotSchema = z.object({
  name: z.string().trim().min(1).max(200),
  destinationName: z.string().trim().min(1).max(120).optional(),
  country: z.string().trim().min(1).max(120).optional(),
  coordinates: z.object({ lat: z.number().finite().min(-90).max(90), lng: z.number().finite().min(-180).max(180) }).strict(),
  category: z.string().trim().min(1).max(60),
  address: z.string().trim().max(1000).optional(),
  description: z.string().trim().max(2000).optional(),
  image: z.url({ protocol: /^https$/ }).max(2000).refine(value => !/^https:\/\/[^/]*@/i.test(value)).optional(),
}).strict();
export type SavedAttractionSnapshot = z.infer<typeof savedAttractionSnapshotSchema>;
export interface SavedAttraction {
  attractionKey: string;
  provider: "overpass" | "geoapify" | "unknown";
  providerPlaceId?: string;
  snapshot: SavedAttractionSnapshot;
  createdAt: string;
}
export interface SavedAttractionsResponse { attractions: SavedAttraction[] }
export interface SavedAttractionKeysResponse { attractionKeys: string[] }
