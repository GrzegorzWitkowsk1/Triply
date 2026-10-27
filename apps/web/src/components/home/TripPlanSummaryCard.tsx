import { formatDate as localizedDate, formatDateRange, formatCurrency, formatNumber } from "../../i18n/format";
import { interestLabel as localizedInterest, paceLabel } from "../../i18n/labels";
import { resolveMessage } from "../../i18n/errors";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import { CheckOutlined, LockOutlined } from "@mui/icons-material";
import { PACE_OPTIONS, interestLabel, type AskableField, type TripAnalysis } from "@triply/shared";

interface TripPlanSummaryCardProps {
  analysis: TripAnalysis;
  missingFields: AskableField[];
  requirementsComplete: boolean;
  onEdit: () => void;
  onGenerate: () => void;
  isGenerating: boolean;
  generateError: string | null;
}

function formatDate(isoDate: string): string { return localizedDate(isoDate, { day: "numeric", month: "short" }); }

function formatRange(analysis: TripAnalysis): string | null {
  if (analysis.startDate && analysis.endDate) {
    return formatDateRange(analysis.startDate, analysis.endDate);
  }

  if (analysis.startDate) {
    return i18n.t("from", { ns: "tripCreator/home", value0: formatDate(analysis.startDate) });
  }

  if (analysis.durationDays) {
    return i18n.t("days", { ns: "common", count: analysis.durationDays });
  }

  return null;
}

function formatBudget(analysis: TripAnalysis): string {
  const { amount, currency } = analysis.budget;

  if (amount === null) {
    return i18n.t("flexible", { ns: "tripCreator/home" });
  }

  return currency ? formatCurrency(amount, currency, { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : formatNumber(amount);
}

function formatPace(pace: TripAnalysis["pace"]): string | null {
  return pace ? paceLabel(pace) : null;
}

export default function TripPlanSummaryCard({
  analysis,
  missingFields,
  requirementsComplete,
  onEdit,
  onGenerate,
  isGenerating,
  generateError,
}: TripPlanSummaryCardProps) {
  useTranslation();
  const facts = [
    formatRange(analysis),
    analysis.travelers ? i18n.t("travellers", { ns: "common", count: analysis.travelers }) : null,
    formatBudget(analysis),
    formatPace(analysis.pace),
    analysis.maxWalkingDistanceKm
      ? i18n.t("kmMaxWalk", { ns: "tripCreator/home", value0: analysis.maxWalkingDistanceKm })
      : null,
  ].filter((fact): fact is string => fact !== null);

  return (
    <section className="plan-card plan-summary" aria-live="polite">
      <div className="plan-head">
        <span className="plan-icon" aria-hidden="true">
          <CheckOutlined />
        </span>
        <div className="plan-head-text">
          <p className="plan-title">
            {analysis.destination
              ? [analysis.destination, analysis.country].filter(Boolean).join(", ")
              : i18n.t("yourTripIsTakingShape", { ns: "tripCreator/home" })}
          </p>
          <p className="plan-subtitle">
            {requirementsComplete
              ? i18n.t("briefReadyTheItineraryComesNext", { ns: "tripCreator/home" })
              : i18n.t("aFewDetailsAreStillOpen", { ns: "tripCreator/home" })}
          </p>
        </div>
      </div>

      <ul className="plan-summary-facts">
        {facts.map((fact) => (
          <li key={fact}>{fact}</li>
        ))}
      </ul>

      {analysis.interests.length > 0 && (
        <div className="plan-summary-tags">
          {analysis.interests.map((interest) => (
            <span key={interest} className="plan-summary-tag">
              {localizedInterest(interest)}
            </span>
          ))}
        </div>
      )}

      {analysis.notes && <p className="plan-summary-notes">{analysis.notes}</p>}

      <div className="plan-summary-actions">
        <button type="button" className="btn" onClick={onEdit}>
          {missingFields.length > 0 ? i18n.t("fillInDetails", { ns: "tripCreator/home" }) : i18n.t("adjustDetails", { ns: "tripCreator/home" })}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!requirementsComplete || isGenerating}
          onClick={onGenerate}
        >
          {isGenerating ? i18n.t("creatingYourTrip", { ns: "tripCreator/home" }) : i18n.t("generateMyTrip", { ns: "tripCreator/home" })}
        </button>
      </div>

      {generateError && <p className="prompt-hint is-error" role="alert">{resolveMessage(generateError)}</p>}

      <p className="plan-summary-block">
        <LockOutlined fontSize="small" />
        {!requirementsComplete
          ? i18n.t("missingQuestions", { ns: "tripCreator/home", count: missingFields.length })
          : isGenerating
            ? i18n.t("buildingYourDayByDayItineraryThisCan", { ns: "tripCreator/home" })
            : i18n.t("weLlBuildYourDayByDayItinerary", { ns: "tripCreator/home" })}
      </p>
    </section>
  );
}
