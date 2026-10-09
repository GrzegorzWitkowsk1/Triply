import type { SchedulingConfig } from "@triply/shared";

/**
 * Central scheduling heuristics. These are approximate planning defaults, not
 * verified facts, and are intentionally kept in one place so they can be tuned
 * or overridden per call without scattering magic numbers through the engine.
 */
export const DEFAULT_SCHEDULING_CONFIG: SchedulingConfig = {
  defaultPace: "balanced",
  pace: {
    relaxed: {
      startMinutes: 10 * 60,
      endMinutes: 17 * 60,
      breaks: {
        lunch: {
          enabled: true,
          windowStartMinutes: 12 * 60,
          windowEndMinutes: 14 * 60,
          durationMinutes: 60,
        },
        coffee: {
          enabled: true,
          windowStartMinutes: 15 * 60,
          windowEndMinutes: 16 * 60 + 30,
          durationMinutes: 30,
        },
        dinner: {
          enabled: false,
          windowStartMinutes: 19 * 60,
          windowEndMinutes: 20 * 60 + 30,
          durationMinutes: 60,
        },
      },
    },
    balanced: {
      startMinutes: 9 * 60,
      endMinutes: 19 * 60,
      breaks: {
        lunch: {
          enabled: true,
          windowStartMinutes: 12 * 60 + 30,
          windowEndMinutes: 14 * 60,
          durationMinutes: 60,
        },
        coffee: {
          enabled: true,
          windowStartMinutes: 15 * 60,
          windowEndMinutes: 16 * 60 + 30,
          durationMinutes: 20,
        },
        dinner: {
          enabled: false,
          windowStartMinutes: 19 * 60,
          windowEndMinutes: 20 * 60 + 30,
          durationMinutes: 60,
        },
      },
    },
    packed: {
      startMinutes: 8 * 60,
      endMinutes: 21 * 60,
      breaks: {
        lunch: {
          enabled: true,
          windowStartMinutes: 12 * 60,
          windowEndMinutes: 14 * 60,
          durationMinutes: 45,
        },
        coffee: {
          enabled: true,
          windowStartMinutes: 15 * 60,
          windowEndMinutes: 16 * 60 + 30,
          durationMinutes: 15,
        },
        dinner: {
          enabled: true,
          windowStartMinutes: 19 * 60,
          windowEndMinutes: 20 * 60 + 30,
          durationMinutes: 60,
        },
      },
    },
  },
  durationEstimates: {
    culture: { minMinutes: 90, maxMinutes: 120 },
    architecture: { minMinutes: 30, maxMinutes: 60 },
    nature: { minMinutes: 45, maxMinutes: 90 },
    beach: { minMinutes: 60, maxMinutes: 120 },
    food: { minMinutes: 60, maxMinutes: 90 },
    shopping: { minMinutes: 45, maxMinutes: 90 },
    nightlife: { minMinutes: 60, maxMinutes: 120 },
    attraction: { minMinutes: 45, maxMinutes: 75 },
  },
  defaultDurationEstimate: { minMinutes: 45, maxMinutes: 75 },
  modeSpeedMps: {
    walking: 1.4,
    cycling: 4.2,
    driving: 8.3,
  },
  unknownTravelFallbackMinutes: 10,
  defaultTimeZone: "UTC",
  weather: {
    highTemperatureC: 32,
    lowTemperatureC: 0,
  },
};

export function mergeSchedulingConfig(overrides?: Partial<SchedulingConfig> | null): SchedulingConfig {
  if (!overrides) {
    return DEFAULT_SCHEDULING_CONFIG;
  }

  return {
    ...DEFAULT_SCHEDULING_CONFIG,
    ...overrides,
    pace: { ...DEFAULT_SCHEDULING_CONFIG.pace, ...overrides.pace },
    durationEstimates: {
      ...DEFAULT_SCHEDULING_CONFIG.durationEstimates,
      ...overrides.durationEstimates,
    },
    modeSpeedMps: { ...DEFAULT_SCHEDULING_CONFIG.modeSpeedMps, ...overrides.modeSpeedMps },
    weather: { ...DEFAULT_SCHEDULING_CONFIG.weather, ...overrides.weather },
  };
}
