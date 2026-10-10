import { AccountBalanceWalletOutlined } from "@mui/icons-material";
import type { BudgetSlice } from "../../config/trip";

interface TripBudgetCardProps {
  whole: number;
  spent?: number | null;
  breakdown?: BudgetSlice[] | null;
  currencySymbol?: string;
}

const REST_COLOR = "#c9c9c9";
const REST_THRESHOLD = 0.25;

export default function TripBudgetCard({
  whole,
  spent = null,
  breakdown = null,
  currencySymbol = "€",
}: TripBudgetCardProps) {
  const hasBreakdown =
    breakdown !== null && breakdown.length > 0 && whole > 0;

  if (!hasBreakdown) {
    return (
      <section className="trip-card budget-card">
        <div className="trip-card-head">
          <h3>Trip Budget</h3>
          <span className="budget-total">
            {currencySymbol}
            {whole} <em>planned</em>
          </span>
        </div>
        <span className="budget-extra">
          <AccountBalanceWalletOutlined /> Your declared budget
        </span>
      </section>
    );
  }

  const spentAmount = spent ?? 0;
  const restItems = breakdown.filter(
    (item) => item.amount / whole <= REST_THRESHOLD
  );
  const restAmount = restItems.reduce((sum, item) => sum + item.amount, 0);
  const segments = breakdown.filter(
    (item) => item.amount / whole > REST_THRESHOLD
  );

  return (
    <section className="trip-card budget-card">
      <div className="trip-card-head">
        <h3>Trip Budget</h3>
        <span className="budget-total">
          {currencySymbol}
          {spentAmount} <em>/ {currencySymbol}{whole}</em>
        </span>
      </div>
      <div className="budget-chart">
        {segments.map((item) => (
          <span
            key={item.label}
            className="budget-segment"
            style={{ background: item.color, width: `${(item.amount / whole) * 100}%` }}
            title={item.label}
          />
        ))}
        {restAmount > 0 && (
          <span
            className="budget-segment"
            style={{ background: REST_COLOR, width: `${(restAmount / whole) * 100}%` }}
            title="Rest"
          />
        )}
      </div>
      <ul className="budget-list">
        {breakdown.map((item) => {
          const isRest = item.amount / whole <= REST_THRESHOLD;
          return (
            <li key={item.label} className="budget-row">
              <span
                className={`budget-dot${isRest ? " is-rest" : ""}`}
                style={isRest ? undefined : { background: item.color }}
              />
              <span className="budget-label">{item.label}</span>
              <span className="budget-amount">
                {currencySymbol}
                {item.amount}
              </span>
            </li>
          );
        })}
      </ul>
      <span className="budget-extra">
        <AccountBalanceWalletOutlined />{" "}
        {whole - spentAmount >= 0
          ? `${currencySymbol}${whole - spentAmount} left`
          : `${currencySymbol}${spentAmount - whole} over budget`}
      </span>
    </section>
  );
}
