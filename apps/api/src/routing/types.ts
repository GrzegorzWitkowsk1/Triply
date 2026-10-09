import type { Coordinates, GeoLineString, TravelMode } from "@triply/shared";

export interface TravelMatrix {
  distancesMeters: (number | null)[][];
  durationsSeconds: (number | null)[][];
}

export interface RouteLegValue {
  fromIndex: number;
  toIndex: number;
  distanceMeters: number | null;
  durationSeconds: number | null;
}

export interface RouteResult {
  distanceMeters: number | null;
  durationSeconds: number | null;
  geometry: GeoLineString | null;
  legs: RouteLegValue[];
}

export interface RoutingProvider {
  readonly name: string;
  readonly supportedModes: readonly TravelMode[];
  supportsMode(mode: TravelMode): boolean;
  getTravelMatrix(
    coordinates: readonly Coordinates[],
    mode: TravelMode,
  ): Promise<TravelMatrix>;
  getRoute(coordinates: readonly Coordinates[], mode: TravelMode): Promise<RouteResult>;
}
