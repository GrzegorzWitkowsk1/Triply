import { getSelectedLanguage } from ".";
import * as shared from "@triply/shared";
export function formatDate(value: string | Date, options: Intl.DateTimeFormatOptions = { dateStyle: "long" }, language = getSelectedLanguage()) { return shared.formatDate(value, options, language); }
export function formatDateRange(start: string, end: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }, language = getSelectedLanguage()) { return shared.formatDateRange(start, end, options, language); }
export function formatLocalTime(value: string, language = getSelectedLanguage()) { return shared.formatLocalTime(value, language); }
export function formatTime(value: string | Date, language = getSelectedLanguage()) { return formatDate(value, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }, language); }
export function formatNumber(value: number, options: Intl.NumberFormatOptions = {}, language = getSelectedLanguage()) { return shared.formatNumber(value, options, language); }
export function formatInteger(value: number, language = getSelectedLanguage()) { return shared.formatInteger(value, language); }
export function formatCurrency(value: number, currency: string, options: Intl.NumberFormatOptions = {}, language = getSelectedLanguage()) { return shared.formatCurrency(value, currency, options, language); }
export function formatMoney(value: number, currency: string, language = getSelectedLanguage()) { return shared.formatMoney(value, currency, language); }
export function formatPercent(value: number, options: Intl.NumberFormatOptions = {}, language = getSelectedLanguage()) { return shared.formatPercent(value, options, language); }
export function formatDistance(meters: number, digits = 1, language = getSelectedLanguage()) { return shared.formatDistance(meters, digits, language); }

/** Normalize only a decimal separator, never parse grouping or a display-formatted amount. */
export function decimalInput(value: string, language = getSelectedLanguage()): string { return language === "pl" ? value.replace(",", ".") : value; }
