import type { TripAttraction } from "./trip.js";

export const POI_CATEGORY_VALUES = [
  "food",
  "architecture",
  "beach",
  "nature",
  "culture",
  "shopping",
  "nightlife",
  "attraction",
] as const;

export type PoiCategory = (typeof POI_CATEGORY_VALUES)[number];

export function isPoiCategory(value: string): value is PoiCategory {
  return (POI_CATEGORY_VALUES as readonly string[]).includes(value);
}

export const POI_ENVIRONMENT_VALUES = ["indoor", "outdoor", "unknown"] as const;

export type PoiEnvironment = (typeof POI_ENVIRONMENT_VALUES)[number];

export interface ClusterablePoi {
  name: string;
  lat: number;
  lng: number;
  score?: number | null;
}

export interface Coordinates {
  lat: number;
  lng: number;
}

export const TRAVEL_MODE_VALUES = ["walking", "driving", "cycling"] as const;

export type TravelMode = (typeof TRAVEL_MODE_VALUES)[number];

export function isTravelMode(value: string): value is TravelMode {
  return (TRAVEL_MODE_VALUES as readonly string[]).includes(value);
}

export const ROUTE_SOURCE_VALUES = ["provider", "approximation", "unavailable"] as const;

export type RouteSource = (typeof ROUTE_SOURCE_VALUES)[number];

export interface GeoLineString {
  type: "LineString";
  coordinates: [number, number][];
}

export interface RouteSegment {
  fromIndex: number;
  toIndex: number;
  distanceMeters: number | null;
  durationSeconds: number | null;
  geometry: GeoLineString | null;
}

export interface OptimizedDayRoute<T extends ClusterablePoi = TripAttraction> {
  dayIndex: number;
  orderedPlaces: T[];
  segments: RouteSegment[];
  totalDistanceMeters: number | null;
  totalDurationSeconds: number | null;
  geometry: GeoLineString | null;
  travelMode: TravelMode;
  routingSource: RouteSource;
  returnsToStart: boolean;
}

export interface PoiCluster<T extends ClusterablePoi = TripAttraction> {
  day: number;
  pois: T[];
  center: { lat: number; lng: number } | null;
  medoid: T | null;
  count: number;
  avgScore: number;
  spreadMeters: number;
}

export interface PoiClusteringResult<T extends ClusterablePoi = TripAttraction> {
  days: number;
  clusters: PoiCluster<T>[];
  unassigned: T[];
  assignedCount: number;
}

