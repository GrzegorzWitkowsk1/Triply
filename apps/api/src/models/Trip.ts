import { model, Schema, type HydratedDocument, type Types } from "mongoose";
import type {
  AskableField,
  DayComparisonMetrics,
  GeoLineString,
  ItineraryDay,
  ItineraryStop,
  PoiCluster,
  RegeneratedDayComparison,
  RegenerationPreferences,
  RouteSegment,
  ScheduledActivity,
  TripAnalysis,
  TripAttraction,
  TripDayWeather,
  TripItinerary,
  TripStatus,
  TripUnscheduledPlace,
} from "@triply/shared";
import { EXPENSE_CATEGORIES, PACE_VALUES, POI_ENVIRONMENT_VALUES, TRIP_STATUS_VALUES } from "@triply/shared";

export interface EquipmentRecord {
  name: string;
  count: number;
}

export interface AttractionsQueryRecord {
  lat: number;
  lng: number;
  interests: string[];
}

export interface ClusteringRecord {
  days: number;
  pace: string | null;
  clusters: PoiCluster[];
  unassigned: TripAttraction[];
}

export interface TripGenerationRecord {
  startedAt: Date | null;
  generatedAt: Date | null;
  error: string | null;
}

export type TripItineraryRecord = Omit<TripItinerary, "generatedAt">;

/**
 * A server-side preview of a single regenerated day. It is kept on the trip
 * document so the saved itinerary stays untouched until the user applies it.
 */
export interface TripRegenerationRecord {
  previewId: string;
  dayIndex: number;
  baseItineraryVersion: number;
  preferences: RegenerationPreferences;
  customInstructions: string | null;
  day: ItineraryDay;
  unscheduled: TripUnscheduledPlace[];
  warnings: string[];
  comparison: RegeneratedDayComparison;
  /** Newly discovered attractions the preview relies on, persisted on apply. */
  newAttractions: TripAttraction[];
  createdAt: Date;
  expiresAt: Date;
}

export interface TripRecord {
  expenses: import("@triply/shared").TripExpense[];
  budgetAllocations: import("@triply/shared").BudgetAllocations;
  budgetAllocationCurrency: string | null;
  budgetRevision: number;
  user: Types.ObjectId;
  status: TripStatus;
  prompt: string;
  badges: string[];
  analysis: TripAnalysis;
  confirmedFields: AskableField[];
  missingFields: AskableField[];
  equipment: Types.DocumentArray<EquipmentRecord>;
  weather: TripDayWeather[];
  weatherFetchedAt: Date | null;
  attractions: TripAttraction[];
  attractionsFetchedAt: Date | null;
  attractionsQuery: AttractionsQueryRecord | null;
  clustering: ClusteringRecord | null;
  itinerary: TripItineraryRecord | null;
  /** Bumped whenever the itinerary changes; used for optimistic concurrency. */
  itineraryVersion: number;
  regeneration: TripRegenerationRecord | null;
  generation: TripGenerationRecord;
  fixtureKey: string | null;
}

export type TripDocument = HydratedDocument<TripRecord>;

const locationSchema = new Schema<TripAnalysis["location"]>(
  {
    lat: { type: Number },
    lng: { type: Number },
    city: { type: String, default: null, trim: true },
    country: { type: String, default: null, trim: true },
  },
  { _id: false },
);

const equipmentItemSchema = new Schema<EquipmentRecord>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    count: { type: Number, required: true, min: 1, max: 999, default: 1 },
  },
  { _id: true },
);

const budgetSchema = new Schema<TripAnalysis["budget"]>(
  {
    amount: { type: Number, default: null },
    currency: { type: String, default: null, trim: true },
    type: { type: String, enum: ["total", "per_person", null], default: null },
  },
  { _id: false },
);

const dayWeatherSchema = new Schema<TripDayWeather>(
  {
    date: { type: String, required: true, trim: true },
    weatherCode: { type: Number, required: true, min: 0, max: 99 },
    temperatureMax: { type: Number, required: true },
  },
  { _id: false },
);

const admissionSchema = new Schema({
  status: { type: String, enum: ["free", "paid", "unknown"], required: true },
  price: { type: new Schema({
    amountMinor: { type: Number, required: true, min: 0, max: Number.MAX_SAFE_INTEGER, validate: Number.isSafeInteger },
    currency: { type: String, required: true, match: /^[A-Z]{3}$/ },
    fractionDigits: { type: Number, required: true, min: 0, max: 3, validate: Number.isInteger },
    priceType: { type: String, enum: ["adult", "general"], required: true },
    unit: { type: String, enum: ["per_person", "per_group", "unknown"], required: true },
  }, { _id: false }), default: null },
  source: { type: String, enum: ["osm", "official", null], default: null },
  sourceUrl: { type: String, default: null, maxlength: 2000 },
  checkedAt: { type: String, default: null },
  retrievedAt: { type: String, default: null },
  rawFee: { type: String, default: null },
  rawCharge: { type: String, default: null },
  rawFeeConditional: { type: String, default: null },
  rawChargeConditional: { type: String, default: null },
  rawCurrency: { type: String, default: null },
  menuUrl: { type: String, default: null },
  notes: { type: String, default: null },
}, { _id: false });
const attractionSchema = new Schema<TripAttraction>(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    category: { type: String, required: true, trim: true, maxlength: 60 },
    lat: { type: Number, required: true, min: -90, max: 90 },
    lng: { type: Number, required: true, min: -180, max: 180 },
    score: { type: Number, min: 0, max: 100 },
    placeId: { type: String, default: null, trim: true },
    environment: { type: String, enum: [...POI_ENVIRONMENT_VALUES, null], default: null },
    visitDurationMinutes: { type: Number, default: null, min: 1, max: 1440 },
    admission: { type: admissionSchema, default: undefined },
    openingHours: { type: new Schema({
      raw: { type: String, default: null, maxlength: 10000 },
      source: { type: String, enum: ["osm", "official", null], default: null },
      checkedAt: { type: String, default: null },
      legacyCovid19: { type: String, default: null },
      website: { type: String, default: null },
    }, { _id: false }), default: undefined },
  },
  { _id: false },
);

const attractionsQuerySchema = new Schema<AttractionsQueryRecord>(
  {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    interests: { type: [String], default: [] },
  },
  { _id: false },
);

const poiCenterSchema = new Schema<{ lat: number; lng: number }>(
  {
    lat: { type: Number, required: true, min: -90, max: 90 },
    lng: { type: Number, required: true, min: -180, max: 180 },
  },
  { _id: false },
);

const clusterSchema = new Schema<PoiCluster>(
  {
    day: { type: Number, required: true, min: 1 },
    pois: { type: [attractionSchema], default: [] },
    center: { type: poiCenterSchema, default: null },
    medoid: { type: attractionSchema, default: null },
    count: { type: Number, required: true, min: 0 },
    avgScore: { type: Number, required: true, min: 0, max: 100 },
    spreadMeters: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const clusteringSchema = new Schema<ClusteringRecord>(
  {
    days: { type: Number, required: true, min: 1, max: 365 },
    pace: { type: String, enum: [...PACE_VALUES, null], default: null },
    clusters: { type: [clusterSchema], default: [] },
    unassigned: { type: [attractionSchema], default: [] },
  },
  { _id: false },
);

const itineraryStopSchema = new Schema<ItineraryStop>(
  {
    admission: { type: admissionSchema, default: undefined },
    placeId: { type: String, default: null, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    category: { type: String, required: true, trim: true, maxlength: 60 },
    lat: { type: Number, required: true, min: -90, max: 90 },
    lng: { type: Number, required: true, min: -180, max: 180 },
    score: { type: Number, default: null, min: 0, max: 100 },
  },
  { _id: false },
);

const geoLineStringSchema = new Schema<GeoLineString>(
  {
    type: { type: String, enum: ["LineString"], required: true },
    coordinates: { type: [[Number]], default: [] },
  },
  { _id: false },
);

const routeSegmentSchema = new Schema<RouteSegment>(
  {
    fromIndex: { type: Number, required: true },
    toIndex: { type: Number, required: true },
    distanceMeters: { type: Number, default: null },
    durationSeconds: { type: Number, default: null },
    geometry: { type: geoLineStringSchema, default: null },
  },
  { _id: false },
);

const itineraryActivitySchema = new Schema<ScheduledActivity>(
  {
    type: { type: String, enum: ["attraction", "travel", "break"], required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    placeId: { type: String },
    title: { type: String, required: true },
    durationMinutes: { type: Number, required: true },
    durationSource: { type: String, enum: ["provided", "estimated", null], default: null },
    distanceMeters: { type: Number, default: null },
    travelDurationSource: {
      type: String,
      enum: ["provider", "approximation", "unavailable", null],
      default: null,
    },
    weatherAdjusted: { type: Boolean, default: false },
    openingHoursCheck: { type: new Schema({
      status: { type: String, enum: ["open", "closed", "unknown"], required: true },
      reason: String,
      source: { type: String, enum: ["osm", "official", null], default: null },
      timeZone: { type: String, default: null },
      intervals: { type: [new Schema({ start: String, end: String, unknown: Boolean }, { _id: false })], default: [] },
      nextAvailableStart: String,
      warnings: { type: [String], default: [] },
    }, { _id: false }), default: undefined },
    warnings: { type: [String], default: undefined },
  },
  { _id: false },
);

const itineraryDaySchema = new Schema<ItineraryDay>(
  {
    routeStopOffset: { type: Number },
    routeReturnsToStart: { type: Boolean },
    travelMode: { type: String, enum: ["walking", "cycling", "driving"] },
    routingSource: { type: String, enum: ["provider", "approximation", "unavailable"] },
    dayIndex: { type: Number, required: true },
    date: { type: String, default: "" },
    timeZone: { type: String, required: true },
    activities: { type: [itineraryActivitySchema], default: [] },
    stops: { type: [itineraryStopSchema], default: [] },
    geometry: { type: geoLineStringSchema, default: null },
    segments: { type: [routeSegmentSchema], default: [] },
    totalVisitMinutes: { type: Number, required: true },
    totalTravelMinutes: { type: Number, default: null },
    totalDistanceMeters: { type: Number, default: null },
    partiallyEstimated: { type: Boolean, default: false },
    warnings: { type: [String], default: [] },
  },
  { _id: false },
);

const unscheduledPlaceSchema = new Schema<TripUnscheduledPlace>(
  {
    place: { type: itineraryStopSchema, required: true },
    dayIndex: { type: Number, default: null },
    reason: { type: String, required: true },
    detail: { type: String, default: null },
  },
  { _id: false },
);

const itinerarySchema = new Schema<TripItineraryRecord>(
  {
    timeZone: { type: String, required: true },
    routingSource: {
      type: String,
      enum: ["provider", "approximation", "unavailable"],
      required: true,
    },
    days: { type: [itineraryDaySchema], default: [] },
    unscheduled: { type: [unscheduledPlaceSchema], default: [] },
  },
  { _id: false },
);

const generationSchema = new Schema<TripGenerationRecord>(
  {
    startedAt: { type: Date, default: null },
    generatedAt: { type: Date, default: null },
    error: { type: String, default: null },
  },
  { _id: false },
);

const dayComparisonMetricsSchema = new Schema<DayComparisonMetrics>(
  {
    attractionCount: { type: Number, required: true, min: 0 },
    walkingMeters: { type: Number, default: null },
    travelMinutes: { type: Number, default: null },
    visitMinutes: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const regenerationComparisonSchema = new Schema<RegeneratedDayComparison>(
  {
    original: { type: dayComparisonMetricsSchema, required: true },
    proposed: { type: dayComparisonMetricsSchema, required: true },
    added: { type: [itineraryStopSchema], default: [] },
    removed: { type: [itineraryStopSchema], default: [] },
  },
  { _id: false },
);

const regenerationPreferencesSchema = new Schema<RegenerationPreferences>(
  {
    lessWalking: { type: Boolean, default: false },
    moreFood: { type: Boolean, default: false },
    relaxedPace: { type: Boolean, default: false },
    preferIndoor: { type: Boolean, default: false },
    surpriseMe: { type: Boolean, default: false },
  },
  { _id: false },
);

const regenerationSchema = new Schema<TripRegenerationRecord>(
  {
    previewId: { type: String, required: true, trim: true },
    dayIndex: { type: Number, required: true },
    baseItineraryVersion: { type: Number, required: true, min: 0 },
    preferences: { type: regenerationPreferencesSchema, required: true },
    customInstructions: { type: String, default: null, trim: true },
    day: { type: itineraryDaySchema, required: true },
    unscheduled: { type: [unscheduledPlaceSchema], default: [] },
    warnings: { type: [String], default: [] },
    comparison: { type: regenerationComparisonSchema, required: true },
    newAttractions: { type: [attractionSchema], default: [] },
    createdAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  { _id: false },
);

const analysisSchema = new Schema<TripAnalysis>(
  {
    destination: { type: String, default: null, trim: true },
    country: { type: String, default: null, trim: true },
    startDate: { type: String, default: null, trim: true },
    endDate: { type: String, default: null, trim: true },
    durationDays: { type: Number, default: null },
    travelers: { type: Number, default: null },
    budget: { type: budgetSchema, default: () => ({ amount: null, currency: null, type: null }) },
    interests: { type: [String], default: [] },
    pace: { type: String, enum: ["relaxed", "balanced", "packed", null], default: null },
    maxWalkingDistanceKm: { type: Number, default: null },
    notes: { type: String, default: null, trim: true },
    location: { type: locationSchema, default: null },
  },
  { _id: false },
);

const tripSchema = new Schema<TripRecord>(
  {
    expenses: { type: [new Schema({
      id: { type: String, required: true }, title: { type: String, required: true, maxlength: 120 },
      category: { type: String, required: true, enum: EXPENSE_CATEGORIES },
      amountMinor: { type: Number, required: true, min: 0, max: Number.MAX_SAFE_INTEGER, validate: Number.isSafeInteger },
      currency: { type: String, required: true }, type: { type: String, enum: ["planned", "actual"], required: true },
      date: { type: String, default: null }, dayId: { type: String, default: null }, attractionId: { type: String, default: null },
      replacesAdmission: { type: Boolean, default: false }, note: { type: String, default: null, maxlength: 2000 },
      createdAt: { type: String, required: true }, updatedAt: { type: String, required: true },
    }, { _id: false })], default: [] },
    budgetAllocations: { type: new Schema(Object.fromEntries(EXPENSE_CATEGORIES.map(key => [key, { type: Number, min: 0, max: Number.MAX_SAFE_INTEGER, validate: Number.isSafeInteger }])), { _id: false }), default: () => ({}) },
    budgetRevision: { type: Number, default: 0, min: 0 },
    budgetAllocationCurrency: { type: String, default: null },
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: TRIP_STATUS_VALUES,
      default: "draft",
    },
    prompt: { type: String, default: "", trim: true },
    badges: { type: [String], default: [] },
    analysis: { type: analysisSchema, required: true },
    confirmedFields: { type: [String], default: [] },
    missingFields: { type: [String], default: [] },
    equipment: { type: [equipmentItemSchema], default: [] },
    weather: { type: [dayWeatherSchema], default: [] },
    weatherFetchedAt: { type: Date, default: null },
    attractions: { type: [attractionSchema], default: [] },
    attractionsFetchedAt: { type: Date, default: null },
    attractionsQuery: { type: attractionsQuerySchema, default: null },
    clustering: { type: clusteringSchema, default: null },
    itinerary: { type: itinerarySchema, default: null },
    itineraryVersion: { type: Number, default: 0, min: 0 },
    regeneration: { type: regenerationSchema, default: null },
    generation: {
      type: generationSchema,
      default: () => ({ startedAt: null, generatedAt: null, error: null }),
    },
    fixtureKey: { type: String, default: null, trim: true },
  },
  { timestamps: true },
);

tripSchema.index({ user: 1, status: 1 });
tripSchema.index({ user: 1, fixtureKey: 1 });

export const TripModel = model<TripRecord>("Trip", tripSchema);
