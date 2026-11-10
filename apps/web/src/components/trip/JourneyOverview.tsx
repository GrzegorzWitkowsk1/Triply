import { visitProgress, type ItineraryDay, type TripBudgetData, type VisitProgress } from "@triply/shared";
import { useTranslation } from "react-i18next";
import { actualSpending } from "../../config/journey";

export default function JourneyOverview({ days, day, visits, budget, loading, error, onRetry }: {
  days: ItineraryDay[]; day?: ItineraryDay; visits?: VisitProgress[]; budget?: TripBudgetData;
  loading: boolean; error: boolean; onRetry: () => void;
}) {
  const { t } = useTranslation("itinerary/journey");
  const whole = visitProgress(days, visits);
  const daily = visitProgress(day ? [day] : [], visits);
  const spending = actualSpending(budget?.summary.totals ?? [], budget?.summary.currency ?? null);
  const dailySpending = actualSpending(budget?.summary.days.find(entry => entry.dayId === String(day?.dayIndex))?.totals ?? [], budget?.summary.currency ?? null);
  return <section className="journey-overview" aria-label={t("overview")}>
    {([["tripProgress", whole], ["dayProgress", daily]] as const).map(([label, progress]) => <div className="journey-progress" key={label}>
      <h2>{t(label)}</h2>
      <p aria-live="polite">{t("visitedCount", progress)}</p>
      <progress max={100} value={progress.percentage} aria-label={t(label)} />
      <p className="journey-progress-detail">{t("remainingCounts", progress)}</p>
    </div>)}
    <div className="journey-spending"><h2>{t("actualSpending")}</h2>
      {loading && !budget ? <p role="status">{t("loadingExpenses")}</p> : <><p className="journey-spending-total">{t("tripSpending", { amount: spending ?? t("noExpenses") })}</p><p className="journey-spending-total">{t("daySpending", { amount: dailySpending ?? t("noExpenses") })}</p></>}
      {error && <p role="alert">{t("expensesUnavailable")} <button type="button" onClick={onRetry}>{t("retry")}</button></p>}
    </div>
  </section>;
}
