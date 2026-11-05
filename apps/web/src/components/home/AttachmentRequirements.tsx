import { useTranslation } from "react-i18next";
import type { CreationContext, TripAnalysis } from "@triply/shared";
import { formatCurrency, formatDate, formatNumber } from "../../i18n/format";
import { interestLabel, paceLabel } from "../../i18n/labels";

export default function AttachmentRequirements({ context, analysis }: { context?: CreationContext; analysis: TripAnalysis }) {
  const { t } = useTranslation("tripCreator/home");
  if (!context) return null;
  const a = { ...context.adopted };
  // Later requirement edits are authoritative; do not advertise superseded document facts.
  if (a.destination !== analysis.destination || a.country !== analysis.country) { a.destination = null; a.country = null; }
  if (a.startDate !== analysis.startDate) a.startDate = null;
  if (a.endDate !== analysis.endDate) a.endDate = null;
  if (a.durationDays !== analysis.durationDays) a.durationDays = null;
  if (a.travelers !== analysis.travelers) a.travelers = null;
  if (JSON.stringify(a.budget) !== JSON.stringify(analysis.budget)) a.budget = { amount: null, currency: null, type: null };
  if (a.pace !== analysis.pace) a.pace = null;
  if (a.maxWalkingDistanceKm !== analysis.maxWalkingDistanceKm) a.maxWalkingDistanceKm = null;
  a.interests = a.interests.filter(interest => analysis.interests.includes(interest));
  const facts = [a.destination && [a.destination, a.country].filter(Boolean).join(", "),
    a.startDate && formatDate(a.startDate), a.endDate && formatDate(a.endDate),
    a.durationDays && t("days", { ns: "common", count: a.durationDays }),
    a.travelers && t("travellers", { ns: "common", count: a.travelers }),
    a.budget.amount !== null && (a.budget.currency ? formatCurrency(a.budget.amount, a.budget.currency) : formatNumber(a.budget.amount)),
    a.pace && paceLabel(a.pace), a.maxWalkingDistanceKm !== null && t("kmMaxWalk", { value0: a.maxWalkingDistanceKm }),
    ...a.interests.map(interestLabel), ...a.requestedAttractions];
  return <div className="attachment-review"><p>{t("attachmentExtracted")}</p>
    <ul>{facts.filter(Boolean).map((fact, index) => <li key={index}>{fact}</li>)}</ul>
    <p className="prompt-hint">{t("attachmentBestEffort")}</p>
  </div>;
}
