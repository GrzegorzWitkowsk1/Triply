import { z } from "zod";

export const SUPPORTED_LOCALES = ["en", "pl"] as const;
export const supportedLocaleSchema = z.enum(SUPPORTED_LOCALES);
export type SupportedLocale = z.infer<typeof supportedLocaleSchema>;
/** Historical generation used English. Never infer language from geography. */
export function contentLocale(value: unknown): SupportedLocale {
  return supportedLocaleSchema.safeParse(value).data ?? "en";
}
/** Optional for source compatibility; API boundaries apply the English default. */
export const localeRequestSchema = z.object({ locale: supportedLocaleSchema.optional() }).strict();
/** Query values are deliberately the same strict enum as AI request locales. */
export const exportLocaleQuerySchema = z.object({ locale: supportedLocaleSchema.default("en") }).strict();
