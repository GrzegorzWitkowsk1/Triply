import { profileNamesSchema, profilePasswordSchema, profilePreferencesSchema, type ProfileNames, type ProfilePreferences } from "@triply/shared";
import type { z } from "zod";
export const profileSchema = profileNamesSchema;
export type ProfileFormValues = ProfileNames;
export const passwordSchema = profilePasswordSchema;
export type PasswordFormValues = z.infer<typeof passwordSchema>;
export const preferencesSchema = profilePreferencesSchema;
export type PreferencesFormValues = ProfilePreferences;
