import { z } from "zod";
import { PACE_VALUES, type TripAnalysis } from "./trip.js";
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
export const MAX_AVATAR_DIMENSION = 2048;
export const AVATAR_TYPES = ["image/jpeg", "image/png", "image/svg+xml"] as const;

export const passwordValueSchema = z.string().min(12, "Password must be at least 12 characters").max(128)
  .regex(/[A-Z]/, "Password must contain an uppercase letter")
  .regex(/[0-9]/, "Password must contain a number")
  .regex(/[^A-Za-z0-9]/, "Password must contain a special character");
const nameSchema = z.string().trim().max(80).refine(value => value === "" || /^[\p{L}][\p{L}\p{M} '\-]*$/u.test(value), "Use letters, spaces, apostrophes or hyphens");
export const profileNamesSchema = z.object({ name: nameSchema, surname: nameSchema });
export const updateProfileNamesSchema = profileNamesSchema.partial().strict().refine(value => Object.keys(value).length > 0, "Provide a name or surname");
export const profilePasswordSchema = z.object({ newPassword: passwordValueSchema, repeatPassword: z.string().min(1, "Repeat your new password") })
  .refine(value => value.newPassword === value.repeatPassword, { path: ["repeatPassword"], message: "Passwords do not match" });
export const changePasswordSchema = profilePasswordSchema.extend({ currentPassword: z.string().min(1, "Enter your current password").max(128) });
export const PROFILE_INTERESTS = ["food", "architecture", "culture", "nature", "shopping", "nightlife"] as const;
export const PROFILE_WALKING_LIMITS = [3, 5, 10] as const;
export const profilePreferencesSchema = z.object({
  interests: z.array(z.enum(PROFILE_INTERESTS)).max(6).refine(values => new Set(values).size === values.length, "Duplicate interests"),
  pace: z.enum(PACE_VALUES),
  maxWalkingDistanceKm: z.union([z.literal(3), z.literal(5), z.literal(10)]),
}).strict();
export type ProfilePreferences = z.infer<typeof profilePreferencesSchema>;
export type ProfileNames = z.infer<typeof profileNamesSchema>;
export type ChangePasswordRequest = z.infer<typeof changePasswordSchema>;
export const DEFAULT_PROFILE_PREFERENCES: ProfilePreferences = { interests: [], pace: "balanced", maxWalkingDistanceKm: 5 };
export interface ProfileUser { id: string; email: string; name?: string; surname?: string; avatar?: string | null; preferences?: ProfilePreferences; }
export function applyProfilePreferences(analysis: TripAnalysis, preferences: Pick<TripAnalysis, "pace" | "maxWalkingDistanceKm">, badges: string[]): TripAnalysis {
  return { ...analysis,
    interests: analysis.interests.length ? analysis.interests : badges,
    pace: analysis.pace ?? preferences.pace,
    maxWalkingDistanceKm: analysis.maxWalkingDistanceKm ?? preferences.maxWalkingDistanceKm,
  };
}
