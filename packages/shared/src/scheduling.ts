import type {
  ClusterablePoi,
  Coordinates,
  OptimizedDayRoute,
  PoiEnvironment,
  TravelMode,
} from "./planner.js";
import type { Pace, TripDayWeather } from "./trip.js";
import type { AttractionOpeningHours, OpeningHoursCheck } from "./openingHours.js";

export const WEEKDAY_VALUES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export type Weekday = (typeof WEEKDAY_VALUES)[number];

export interface OpeningWindow {
  /** Minutes from local midnight when the place opens. */
  openMinutes: number;
  /** Minutes from local midnight when the place closes. Values <= openMinutes cross midnight. */
  closeMinutes: number;
}

export interface OpeningHours {
  weekly: Partial<Record<Weekday, OpeningWindow[]>>;
}

/**
 * A point of interest the scheduler can reason about. Extends the routing
 * `ClusterablePoi` contract with optional planning metadata. Every field is
 * optional so existing `TripAttraction` objects remain valid inputs.
 */
export interface SchedulablePoi extends ClusterablePoi {
  admission?: import("./admission.js").AttractionAdmission | null;
  placeId?: string;
  category?: string;
  visitDurationMinutes?: number | null;
  environment?: PoiEnvironment;
  openingHours?: OpeningHours | AttractionOpeningHours | null;
}

export type ScheduledActivityType = "attraction" | "travel" | "break";

export type DurationSource = "provided" | "estimated";

export type TravelDurationSource = "provider" | "approximation" | "unavailable";

export interface ScheduledActivity {
  type: ScheduledActivityType;
  /** Local ISO 8601 date-time without offset, e.g. `2026-06-01T10:00:00`. */
  startTime: string;
  endTime: string;
  placeId?: string;
  title: string;
  durationMinutes: number;
  durationSource?: DurationSource;
  distanceMeters?: number | null;
  travelDurationSource?: TravelDurationSource;
  weatherAdjusted?: boolean;
  openingHoursCheck?: OpeningHoursCheck;
  warnings?: string[];
}

export type UnscheduledReason =
  | "insufficient-time"
  | "opening-hours-conflict"
  | "invalid-location"
  | "unassigned-cluster";

export interface UnscheduledPlace<T extends ClusterablePoi = ClusterablePoi> {
  place: T;
  dayIndex: number | null;
  reason: UnscheduledReason;
  detail?: string;
}

export interface DailySchedule<T extends ClusterablePoi = ClusterablePoi> {
  dayIndex: number;
  /** Destination-local calendar date (YYYY-MM-DD), or "" when unknown. */
  date: string;
  timeZone: string;
  activities: ScheduledActivity[];
  totalVisitMinutes: number;
  totalTravelMinutes: number | null;
  totalDistanceMeters: number | null;
  partiallyEstimated: boolean;
  warnings: string[];
}

export interface DailySchedulingResult<T extends ClusterablePoi = ClusterablePoi> {
  timeZone: string;
  days: DailySchedule<T>[];
  unscheduledPlaces: UnscheduledPlace<T>[];
}

export interface DailyTimeWindow {
  startMinutes: number;
  endMinutes: number;
}

export interface BreakRule {
  enabled: boolean;
  windowStartMinutes: number;
  windowEndMinutes: number;
  durationMinutes: number;
}

export interface PaceScheduleProfile {
  startMinutes: number;
  endMinutes: number;
  breaks: {
    lunch: BreakRule;
    coffee: BreakRule;
    dinner: BreakRule;
  };
}

export interface DurationEstimate {
  minMinutes: number;
  maxMinutes: number;
}

export interface WeatherThresholds {
  highTemperatureC: number;
  lowTemperatureC: number;
}

export interface SchedulingConfig {
  defaultPace: Pace;
  pace: Record<Pace, PaceScheduleProfile>;
  durationEstimates: Record<string, DurationEstimate>;
  defaultDurationEstimate: DurationEstimate;
  modeSpeedMps: Record<TravelMode, number>;
  unknownTravelFallbackMinutes: number;
  defaultTimeZone: string;
  weather: WeatherThresholds;
}

export interface DayWindowOverride {
  dayIndex: number;
  startMinutes?: number;
  endMinutes?: number;
}

export interface DailySchedulingInput<T extends ClusterablePoi = SchedulablePoi> {
  dayRoutes: readonly OptimizedDayRoute<T>[];
  travelMode: TravelMode;
  pace?: Pace | null;
  weather?: readonly TripDayWeather[] | null;
  timeZone?: string | null;
  /** ISO date for day 1; subsequent days are derived by incrementing the calendar date. */
  startDate?: string | null;
  /** Optional explicit date per schedule position (overrides startDate for that day). */
  dates?: readonly (string | null)[] | null;
  /** The same start coordinate used by routing, required to place base travel segments. */
  start?: Coordinates | null;
  config?: Partial<SchedulingConfig>;
  dayWindows?: readonly DayWindowOverride[] | null;
  arrivalTimeMinutes?: number | null;
  departureTimeMinutes?: number | null;
}
