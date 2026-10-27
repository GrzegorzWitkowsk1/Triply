import enPdf from "./locales/en/exports/pdf.json" with { type: "json" };
import plPdf from "./locales/pl/exports/pdf.json" with { type: "json" };
import enCalendar from "./locales/en/exports/calendar.json" with { type: "json" };
import plCalendar from "./locales/pl/exports/calendar.json" with { type: "json" };
import { contentLocale, type SupportedLocale } from "./locale.js";

export const exportResources = {
  en: { "exports/pdf": enPdf, "exports/calendar": enCalendar },
  pl: { "exports/pdf": plPdf, "exports/calendar": plCalendar },
};
/** Small server-side interpolator over the same catalogs validated with UI translations. */
export function exportText<N extends keyof typeof exportResources.en>(locale: SupportedLocale, namespace: N) {
  const catalog = exportResources[contentLocale(locale)][namespace] as Record<keyof (typeof exportResources.en)[N], string>;
  return (key: keyof (typeof exportResources.en)[N], values: Record<string, string | number> = {}): string =>
    catalog[key].replace(/\{\{(\w+)\}\}/g, (token, name: string) => Object.hasOwn(values, name) ? String(values[name]) : token);
}
/** Translate only scheduler-owned generic labels, never a venue/user/AI description. */
export function exportActivityTitle(title: string, type: string, locale: SupportedLocale): string {
  if (type !== "break") return title;
  const keys: Record<string, "lunch" | "coffee" | "dinner"> = {
    "Lunch break": "lunch", "Przerwa na obiad": "lunch", "Coffee break": "coffee", "Przerwa na kawę": "coffee", "Dinner break": "dinner", "Przerwa na kolację": "dinner",
  };
  return Object.hasOwn(keys, title) ? exportText(locale, "exports/calendar")(keys[title]) : title;
}
