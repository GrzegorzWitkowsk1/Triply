import { profileNamesSchema, profilePasswordSchema, profilePreferencesSchema, type ProfileNames, type ProfilePreferences } from "@triply/shared";
import { z } from "zod";

/** Reuse shared validation rules; store resource keys so existing errors switch language too. */
function localizedSchema<T>(schema: z.ZodType<T>) {
  return z.any().transform((value, ctx): T => {
    const result = schema.safeParse(value);
    if (result.success) return result.data;
    for (const issue of result.error.issues) {
      const field = String(issue.path[0] ?? "");
      let key = "invalidValue";
      if (field === "name" || field === "surname") key = issue.code === "too_big" ? "nameMax" : "nameCharacters";
      else if (field === "repeatPassword") key = issue.code === "too_small" ? "repeatPassword" : "passwordMismatch";
      else if (field === "newPassword") {
        if (issue.code === "too_small") key = "passwordMin";
        else if (issue.code === "too_big") key = "passwordMax";
        else if (issue.code === "invalid_format") {
          const pattern = "pattern" in issue ? String(issue.pattern) : "";
          key = pattern.includes("[A-Z]") ? "passwordUppercase" : pattern.includes("[0-9]") ? "passwordNumber" : "passwordSpecial";
        }
      }
      ctx.addIssue({ code: "custom", path: issue.path, message: `auth/validation:${key}` });
    }
    return z.NEVER;
  });
}
export const profileSchema = localizedSchema(profileNamesSchema);
export type ProfileFormValues = ProfileNames;
export const passwordSchema = localizedSchema(profilePasswordSchema);
export type PasswordFormValues = z.infer<typeof profilePasswordSchema>;
export const preferencesSchema = localizedSchema(profilePreferencesSchema);
export type PreferencesFormValues = ProfilePreferences;
