import type { TravelMode } from "@triply/shared";
import { env } from "../../config/env.js";
import type { RoutingProvider } from "../types.js";
import { createOsrmProvider } from "./osrm.js";

export interface RoutingProviderConfig {
  ROUTING_PROVIDER: string;
  ROUTING_OSRM_URL: string;
  ROUTING_OSRM_PROFILE?: string;
  ROUTING_ENABLED_MODES: readonly TravelMode[];
  ROUTING_TIMEOUT_MS: number;
}

const SUPPORTED_PROVIDERS = ["osrm", "none"] as const;

export function createRoutingProvider(
  config: RoutingProviderConfig = env,
): RoutingProvider | null {
  switch (config.ROUTING_PROVIDER) {
    case "none":
      return null;

    case "osrm":
      return createOsrmProvider({
        baseUrl: config.ROUTING_OSRM_URL,
        profile: config.ROUTING_OSRM_PROFILE,
        supportedModes: config.ROUTING_ENABLED_MODES,
        timeoutMs: config.ROUTING_TIMEOUT_MS,
      });

    default:
      throw new Error(
        `Unsupported ROUTING_PROVIDER "${config.ROUTING_PROVIDER}". Supported values: ${SUPPORTED_PROVIDERS.join(", ")}.`,
      );
  }
}
