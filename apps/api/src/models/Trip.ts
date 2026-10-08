import { model, Schema, type HydratedDocument, type Types } from "mongoose";
import type {
  AskableField,
  TripAnalysis,
  TripAttraction,
  TripDayWeather,
  TripStatus,
} from "@triply/shared";
import { TRIP_STATUS_VALUES } from "@triply/shared";

export interface EquipmentRecord {
  name: string;
  count: number;
}

export interface AttractionsQueryRecord {
  lat: number;
  lng: number;
  interests: string[];
}

export interface TripRecord {
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

const attractionSchema = new Schema<TripAttraction>(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    category: { type: String, required: true, trim: true, maxlength: 60 },
    lat: { type: Number, required: true, min: -90, max: 90 },
    lng: { type: Number, required: true, min: -180, max: 180 },
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
    fixtureKey: { type: String, default: null, trim: true },
  },
  { timestamps: true },
);

tripSchema.index({ user: 1, status: 1 });
tripSchema.index({ user: 1, fixtureKey: 1 });

export const TripModel = model<TripRecord>("Trip", tripSchema);