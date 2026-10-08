import { CheckOutlined, LockOutlined } from "@mui/icons-material";
import { PACE_OPTIONS, interestLabel, type AskableField, type TripAnalysis } from "@triply/shared";

interface TripPlanSummaryCardProps {
  analysis: TripAnalysis;
  missingFields: AskableField[];
  requirementsComplete: boolean;
  onEdit: () => void;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  EUR: "€",
  USD: "$",
  GBP: "£",
  PLN: "zł",
  CHF: "CHF ",
};

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function formatDate(isoDate: string): string {
  return dateFormat.format(new Date(`${isoDate}T00:00:00.000Z`));
}

function formatRange(analysis: TripAnalysis): string | null {
  if (analysis.startDate && analysis.endDate) {
    return `${formatDate(analysis.startDate)} – ${formatDate(analysis.endDate)}`;
  }

  if (analysis.startDate) {
    return `from ${formatDate(analysis.startDate)}`;
  }

  if (analysis.durationDays) {
    return `${analysis.durationDays} days`;
  }

  return null;
}

function formatBudget(analysis: TripAnalysis): string {
  const { amount, currency } = analysis.budget;

  if (amount === null) {
    return "Flexible";
  }

  const symbol = currency ? CURRENCY_SYMBOLS[currency] ?? `${currency} ` : "";

  return `${symbol}${amount}`;
}

function formatPace(pace: TripAnalysis["pace"]): string | null {
  return PACE_OPTIONS.find((option) => option.value === pace)?.label ?? null;
}

export default function TripPlanSummaryCard({
  analysis,
  missingFields,
  requirementsComplete,
  onEdit,
}: TripPlanSummaryCardProps) {
  const facts = [
    formatRange(analysis),
    analysis.travelers ? `${analysis.travelers} travellers` : null,
    formatBudget(analysis),
    formatPace(analysis.pace),
    analysis.maxWalkingDistanceKm
      ? `${analysis.maxWalkingDistanceKm} km max walk`
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
              : "Your trip is taking shape"}
          </p>
          <p className="plan-subtitle">
            {requirementsComplete
              ? "Brief ready — the itinerary comes next."
              : "A few details are still open."}
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
              {interestLabel(interest)}
            </span>
          ))}
        </div>
      )}

      {analysis.notes && <p className="plan-summary-notes">{analysis.notes}</p>}

      <div className="plan-summary-actions">
        <button type="button" className="btn" onClick={onEdit}>
          {missingFields.length > 0 ? "Fill in details" : "Adjust details"}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!requirementsComplete}
        >
          Continue
        </button>
      </div>

      <p className="plan-summary-block">
        <LockOutlined fontSize="small" />
        {!requirementsComplete
          ? missingFields.length === 1
            ? "Answer 1 more question to unlock the next step."
            : `Answer ${missingFields.length} more questions to unlock the next step.`
          : "Itinerary generation is the next step."}
      </p>
    </section>
  );
}