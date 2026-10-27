import i18n from ".";
import type { AttractionAdmission, ExpenseCategory, WeatherAvailability, ItineraryIssue } from "@triply/shared";
import { formatCurrency } from "./format";

export function interestLabel(id: string): string {
  const key = `interest_${id.toLowerCase()}`;
  return i18n.exists(key, { ns: "tripCreator/preferences" }) ? i18n.t(key, { ns: "tripCreator/preferences" }) : id;
}
export function paceLabel(value: string | null | undefined): string {
  return i18n.t(`pace_${value ?? "balanced"}`, { ns: "tripCreator/preferences" });
}
export function categoryLabel(id: string): string {
  const key = `category_${id.toLowerCase().replaceAll(" ", "_")}`;
  return i18n.exists(key, { ns: "itinerary/categories" }) ? i18n.t(key, { ns: "itinerary/categories" }) : i18n.t("category_attraction", { ns: "itinerary/categories" });
}
export function expenseCategoryLabel(id: ExpenseCategory): string { return i18n.t(`category_${id}`, { ns: "expenses" }); }
/** Exact scheduler-owned titles only; preserve arbitrary user, place and AI content. */
export function breakLabel(title: string): string {
  const keys: Record<string, string> = { "Lunch break": "breakLunch", "Coffee break": "breakCoffee", "Dinner break": "breakDinner" };
  return Object.hasOwn(keys, title) ? i18n.t(keys[title], { ns: "itinerary/editor" }) : title;
}
export function localizedAdmission(admission?: AttractionAdmission | null): string {
  if (admission?.rawFeeConditional || admission?.rawChargeConditional) return i18n.t("conditional", { ns: "itinerary/admission" });
  if (admission?.status === "free") return i18n.t("free", { ns: "itinerary/admission" });
  if (admission?.status === "paid") {
    if (!admission.price) return i18n.t("paidUnknown", { ns: "itinerary/admission" });
    return i18n.t(`price_${admission.price.unit}`, { ns: "itinerary/admission", amount: formatCurrency(admission.price.amountMinor / 10 ** admission.price.fractionDigits, admission.price.currency) });
  }
  return i18n.t("unknown", { ns: "itinerary/admission" });
}
export function localizedWeather(availability: WeatherAvailability): string | null {
  if (availability.status === "available" && !availability.reason) return null;
  const key = availability.status === "temporarily_unavailable" ? availability.reason === "invalid_response" ? "invalidResponse" : !availability.canRetry ? "cannotRetry" : availability.reason === "timeout" ? "timeout" : "temporarily_unavailable" : availability.status;
  return i18n.t(key, { ns: "trips/weather" });
}
export function issueMessage(issue: Pick<ItineraryIssue, "code" | "dimension">): string {
  const key = `issue_${issue.code}`;
  return i18n.exists(key, { ns: "itinerary/quality" }) ? i18n.t(key, { ns: "itinerary/quality" }) : i18n.t(`dimension_${issue.dimension}`, { ns: "itinerary/quality" });
}
