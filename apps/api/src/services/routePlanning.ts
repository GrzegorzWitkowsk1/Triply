import type {
  ClusterablePoi,
  Coordinates,
  OptimizedDayRoute,
  PoiCluster,
  RouteSource,
  TravelMode,
  TripAttraction,
} from "@triply/shared";
import { env } from "../config/env.js";
import { createRoutingProvider } from "../routing/index.js";
import type { RoutingProvider } from "../routing/types.js";
import { optimizeClusterRoute } from "./routeOptimizer.js";

export interface RoutableClustering<T extends ClusterablePoi = TripAttraction> {
  clusters: PoiCluster<T>[];
}

export interface BuildTripRoutingOptions {
  mode?: TravelMode | null;
  start?: Coordinates | null;
  returnToStart?: boolean | null;
  provider?: RoutingProvider | null;
  maxMatrixPoints?: number;
}

export interface TripRoutingResult<T extends ClusterablePoi = TripAttraction> {
  mode: TravelMode;
  dayRoutes: OptimizedDayRoute<T>[];
  source: RouteSource;
}

function aggregateSource(routes: readonly { routingSource: RouteSource }[]): RouteSource {
  if (routes.length === 0) {
    return "unavailable";
  }

  if (routes.some((route) => route.routingSource === "approximation")) {
    return "approximation";
  }

  if (routes.some((route) => route.routingSource === "provider")) {
    return "provider";
  }

  return "unavailable";
}

export async function buildTripRouting<T extends ClusterablePoi = TripAttraction>(
  clustering: RoutableClustering<T>,
  options: BuildTripRoutingOptions = {},
): Promise<TripRoutingResult<T>> {
  const mode = options.mode ?? env.ROUTING_MODE;
  const start = options.start ?? null;
  const returnToStart = options.returnToStart ?? env.ROUTING_RETURN_TO_START;
  const provider =
    options.provider !== undefined ? options.provider : createRoutingProvider();

  const dayRoutes: OptimizedDayRoute<T>[] = [];

  for (const cluster of clustering.clusters) {
    const route = await optimizeClusterRoute<T>(cluster, {
      mode,
      start,
      returnToStart,
      provider,
      maxMatrixPoints: options.maxMatrixPoints,
    });

    dayRoutes.push(route);
  }

  return {
    mode,
    dayRoutes,
    source: aggregateSource(dayRoutes),
  };
}
