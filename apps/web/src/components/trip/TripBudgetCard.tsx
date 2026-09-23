import { AccountBalanceWalletOutlined } from "@mui/icons-material";
import type { BudgetSlice } from "../../config/trip";

interface TripBudgetCardProps {
  spent: number;
  whole: number;
  breakdown: BudgetSlice[];
}

const REST_COLOR = "#c9c9c9";
const REST_THRESHOLD = 0.25;

export default function TripBudgetCard({ spent, whole, breakdown }: TripBudgetCardProps) {
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
          €{spent} <em>/ €{whole}</em>
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
              <span className="budget-amount">€{item.amount}</span>
            </li>
          );
        })}
      </ul>
      <span className="budget-extra">
        <AccountBalanceWalletOutlined /> {whole - spent >= 0 ? `${whole - spent} left` : `${spent - whole} over budget`}
      </span>
    </section>
  );
}