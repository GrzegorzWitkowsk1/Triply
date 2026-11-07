import { model, Schema, type HydratedDocument } from "mongoose";
import { DEFAULT_PROFILE_PREFERENCES, DEFAULT_JOURNEY_PREFERENCES, type ProfilePreferences, type ProfileUser, type JourneyPreferences } from "@triply/shared";

export interface UserRecord {
  journeyPreferences?: JourneyPreferences;
  journeyPreferencesRevision: number;
  email: string;
  passwordHash: string;
  name?: string;
  surname?: string;
  avatar?: string | null;
  preferences?: ProfilePreferences;
}

export type UserDocument = HydratedDocument<UserRecord>;

export type PublicUser = ProfileUser;

const userSchema = new Schema<UserRecord>(
  {
    journeyPreferences: { type: new Schema({ promptForExpenseAfterVisit: { type: Boolean, default: DEFAULT_JOURNEY_PREFERENCES.promptForExpenseAfterVisit, required: true } }, { _id: false }), default: () => ({ ...DEFAULT_JOURNEY_PREFERENCES }) },
    journeyPreferencesRevision: { type: Number, default: 0, min: 0 },
    name: { type: String, default: "" },
    surname: { type: String, default: "" },
    avatar: { type: String, default: null },
    preferences: { type: new Schema({ interests: [String], pace: String, maxWalkingDistanceKm: Number }, { _id: false }), default: () => ({ ...DEFAULT_PROFILE_PREFERENCES, interests: [] }) },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
  },
  { timestamps: true },
);

export const UserModel = model<UserRecord>("User", userSchema);

export function toPublicUser(user: Pick<UserDocument, "_id" | "email" | "name" | "surname" | "avatar" | "preferences">): PublicUser {
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name ?? "",
    surname: user.surname ?? "",
    avatar: user.avatar ?? null,
    preferences: user.preferences ?? { ...DEFAULT_PROFILE_PREFERENCES, interests: [] },
  };
}
