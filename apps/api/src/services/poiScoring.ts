import {
  isPoiCategory,
  type PoiEnvironment,
  type TripDayWeather,
} from "@triply/shared";
import type { NormalizedPoi } from "./poiFiltering.js";
import { normalizeInterests } from "./poiFiltering.js";

export interface ScoringWeights {
  interest: number;
  distance: number;
  weather: number;
  metadata: number;
  diversity: number;
}

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  interest: 0.4,
  distance: 0.25,
  weather: 0.1,
  metadata: 0.1,
  diversity: 0.15,
};

export const SCORING_CONFIG = {
  neutralInterestScore: 0.75,
  genericCategoryInterestScore: 0.5,
  unmatchedInterestScore: 0.3,
  metadataBase: 0.4,
  metadataSpan: 0.6,
  metadataTagLimit: 3,
  defaultRadiusMeters: 5000,
  adverseShareThreshold: 0.34,
  freezingTempMaxC: 0,
  suitability: {
    adverse: { indoor: 1, outdoor: 0.25, unknown: 0.5 },
    fair: { indoor: 0.9, outdoor: 1, unknown: 0.9 },
  },
} as const;

export interface ScoreBreakdown {
  interest: number;
  distance: number;
  weather: number | null;
  metadata: number;
  diversity: number;
}

export interface ScoredPoi extends NormalizedPoi {
  score: number;
  breakdown: ScoreBreakdown;
}

export interface PoiScoringContext {
  interests: readonly string[];
  weather?: readonly TripDayWeather[] | null;
  radiusMeters?: number;
  weights?: Partial<ScoringWeights>;
}

export interface WeatherProfile {
  adverse: boolean;
  adverseShare: number;
  totalDays: number;
}

function isPrecipitationCode(code: number): boolean {
  return (
    (code >= 51 && code <= 67) ||
    (code >= 71 && code <= 77) ||
    (code >= 80 && code <= 82) ||
    (code >= 85 && code <= 86) ||
    (code >= 95 && code <= 99)
  );
}

function isAdverseDay(day: TripDayWeather): boolean {
  return (
    isPrecipitationCode(day.weatherCode) ||
    day.temperatureMax <= SCORING_CONFIG.freezingTempMaxC
  );
}

export function deriveWeatherProfile(
  days: readonly TripDayWeather[] | null | undefined,
): WeatherProfile | null {
  if (!days || days.length === 0) {
    return null;
  }

  let adverseDays = 0;

  for (const day of days) {
    if (isAdverseDay(day)) {
      adverseDays += 1;
    }
  }

  const adverseShare = adverseDays / days.length;

  return {
    adverse: adverseShare >= SCORING_CONFIG.adverseShareThreshold,
    adverseShare,
    totalDays: days.length,
  };
}

export function weatherSuitability(
  profile: WeatherProfile,
  environment: PoiEnvironment,
): number {
  const table = profile.adverse ? SCORING_CONFIG.suitability.adverse : SCORING_CONFIG.suitability.fair;

  return table[environment];
}

function interestScore(
  category: string,
  interestSet: ReadonlySet<string>,
  hasCanonicalInterests: boolean,
): number {
  if (interestSet.has(category)) {
    return 1;
  }

  if (!hasCanonicalInterests) {
    return SCORING_CONFIG.neutralInterestScore;
  }

  if (category === "attraction") {
    return SCORING_CONFIG.genericCategoryInterestScore;
  }

  return SCORING_CONFIG.unmatchedInterestScore;
}

function distanceScore(distanceMeters: number, radiusMeters: number): number {
  if (radiusMeters <= 0) {
    return 0;
  }

  return Math.max(0, 1 - distanceMeters / radiusMeters);
}

function metadataScore(metadataCount: number): number {
  const covered = Math.min(metadataCount, SCORING_CONFIG.metadataTagLimit);

  return (
    SCORING_CONFIG.metadataBase +
    (SCORING_CONFIG.metadataSpan * covered) / SCORING_CONFIG.metadataTagLimit
  );
}

function compareTieBreak(a: NormalizedPoi, b: NormalizedPoi): number {
  if (a.distanceMeters !== b.distanceMeters) {
    return a.distanceMeters - b.distanceMeters;
  }

  if (a.name !== b.name) {
    return a.name < b.name ? -1 : 1;
  }

  const aKey = a.osmKey ?? "";
  const bKey = b.osmKey ?? "";

  if (aKey !== bKey) {
    return aKey < bKey ? -1 : 1;
  }

  return 0;
}

interface BaseEntry {
  poi: NormalizedPoi;
  interest: number;
  distance: number;
  weather: number | null;
  metadata: number;
  base: number;
}

export function scorePois(
  pois: readonly NormalizedPoi[],
  context: PoiScoringContext,
): ScoredPoi[] {
  if (pois.length === 0) {
    return [];
  }

  const weights: ScoringWeights = { ...DEFAULT_SCORING_WEIGHTS, ...context.weights };
  const interests = normalizeInterests(context.interests);
  const interestSet = new Set(interests);
  const hasCanonicalInterests = interests.some(
    (interest) => interest !== "attraction" && isPoiCategory(interest),
  );
  const radiusMeters = context.radiusMeters ?? SCORING_CONFIG.defaultRadiusMeters;
  const weatherProfile = deriveWeatherProfile(context.weather);

  const entries: BaseEntry[] = pois.map((poi) => {
    const interest = interestScore(poi.category, interestSet, hasCanonicalInterests);
    const distance = distanceScore(poi.distanceMeters, radiusMeters);
    const weather = weatherProfile ? weatherSuitability(weatherProfile, poi.environment) : null;
    const metadata = metadataScore(poi.metadataCount);
    const base =
      weights.interest * interest +
      weights.distance * distance +
      (weather !== null ? weights.weather * weather : 0) +
      weights.metadata * metadata;

    return { poi, interest, distance, weather, metadata, base };
  });

  entries.sort((a, b) => {
    if (a.base !== b.base) {
      return b.base - a.base;
    }

    return compareTieBreak(a.poi, b.poi);
  });

  const categoryCounts = new Map<string, number>();
  const scored: ScoredPoi[] = [];

  for (const entry of entries) {
    const seen = categoryCounts.get(entry.poi.category) ?? 0;
    categoryCounts.set(entry.poi.category, seen + 1);

    const diversity = 1 / (1 + seen);
    const weatherWeight = entry.weather !== null ? weights.weather : 0;
    const applicableWeight =
      weights.interest + weights.distance + weights.metadata + weights.diversity + weatherWeight;
    const weighted =
      weights.interest * entry.interest +
      weights.distance * entry.distance +
      weatherWeight * (entry.weather ?? 0) +
      weights.metadata * entry.metadata +
      weights.diversity * diversity;
    const normalized = applicableWeight > 0 ? (weighted / applicableWeight) * 100 : 0;
    const score = Math.min(100, Math.max(0, Math.round(normalized)));

    scored.push({
      ...entry.poi,
      score,
      breakdown: {
        interest: entry.interest,
        distance: entry.distance,
        weather: entry.weather,
        metadata: entry.metadata,
        diversity,
      },
    });
  }

  scored.sort((a, b) => {
    if (a.score !== b.score) {
      return b.score - a.score;
    }

    return compareTieBreak(a, b);
  });

  return scored;
}
