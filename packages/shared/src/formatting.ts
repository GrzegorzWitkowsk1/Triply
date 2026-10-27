import { contentLocale, type SupportedLocale } from "./locale.js";

export const intlLocale = (locale: SupportedLocale) => contentLocale(locale) === "pl" ? "pl-PL" : "en-US";
function calendarDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new RangeError("Invalid calendar date");
  return date;
}
/** ISO dates are calendar values; an optional display timezone never shifts their day. */
export function formatDate(value: string | Date, options: Intl.DateTimeFormatOptions = { dateStyle: "long" }, locale: SupportedLocale = "en"): string {
  const dateOnly = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  return new Intl.DateTimeFormat(intlLocale(locale), { ...options, ...(dateOnly ? { timeZone: "UTC" } : {}) })
    .format(dateOnly ? calendarDate(value as string) : typeof value === "string" ? new Date(value) : value);
}
export function formatDateRange(start: string, end: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }, locale: SupportedLocale = "en"): string {
  const from = calendarDate(start), to = calendarDate(end);
  const year = from.getUTCFullYear() !== to.getUTCFullYear() && !options.dateStyle && !options.year ? { year: "numeric" as const } : {};
  const formatter = new Intl.DateTimeFormat(intlLocale(locale), { ...options, ...year, timeZone: "UTC" });
  return start === end ? formatter.format(from) : formatter.formatRange(from, to);
}
/** Saved schedule strings are destination wall-clock values, not browser-local instants. */
export function formatLocalTime(value: string, locale: SupportedLocale = "en"): string {
  const match = /T([01]\d|2[0-3]):([0-5]\d)/.exec(value);
  if (!match) throw new RangeError("Invalid local time");
  return new Intl.DateTimeFormat(intlLocale(locale), { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" })
    .format(new Date(`2000-01-01T${match[1]}:${match[2]}:00Z`));
}
export function formatNumber(value: number, options: Intl.NumberFormatOptions = {}, locale: SupportedLocale = "en"): string {
  return new Intl.NumberFormat(intlLocale(locale), options).format(value);
}
export function formatInteger(value: number, locale: SupportedLocale = "en"): string { return formatNumber(value, { maximumFractionDigits: 0 }, locale); }
export function formatCurrency(value: number, currency: string, options: Intl.NumberFormatOptions = {}, locale: SupportedLocale = "en"): string {
  return formatNumber(value, { ...options, style: "currency", currency }, locale);
}
export function formatPercent(value: number, options: Intl.NumberFormatOptions = {}, locale: SupportedLocale = "en"): string { return formatNumber(value, { ...options, style: "percent" }, locale); }
export function formatDistance(meters: number, digits = 1, locale: SupportedLocale = "en"): string {
  return `${formatNumber(meters / 1000, { minimumFractionDigits: digits, maximumFractionDigits: digits }, locale)} km`;
}
